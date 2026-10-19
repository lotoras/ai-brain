#!/usr/bin/env python3
"""Generate video (default) / images (opt-in) through the OpenRouter API (stdlib only).

Images here only when the user explicitly says "use OpenRouter"; the default image reroute is
codex_image.py (Codex CLI, ChatGPT subscription, no cost gate). OpenRouter = video by default.

    python openrouter.py models --kind image|video
    python openrouter.py image  (--prompt TEXT | --prompt-file F) --out PATH
                                [--model google/gemini-2.5-flash-image] [--ref IMG ...]
                                [--aspect 16:9] [--resolution 1K] [--seed N] [--n 1]
                                [--yes] [--max-cost USD]
    python openrouter.py video  (--prompt TEXT | --prompt-file F) --out PATH --first IMG
                                [--last IMG] [--model google/veo-3.1] [--duration 4]
                                [--aspect 16:9] [--resolution 1080p] [--audio] [--poll 10]
                                [--timeout 900] [--yes] [--max-cost USD]
    python openrouter.py budget
    python openrouter.py video  --resume JOB_ID --out PATH [--poll 10] [--timeout 900]

Cost gate: image/video submits print a COST ESTIMATE and exit 3 (dry run) unless --yes is given;
with --yes they exit 4 if the estimate exceeds the per-call cap (OPENROUTER_MAX_COST_PER_CALL,
default 3; --max-cost overrides it once), the daily limit (OPENROUTER_DAILY_LIMIT, default 10), the
credits left or the key limit, or if the estimate/usage is unknown and --max-cost is absent. Limits
come from env vars, else the same .env as the key. Audio is off unless --audio (it doubles cost).

IMG is a local file (sent as a base64 data URL) or an http(s) URL (passed through).
Key lookup: env OPENROUTER_API_KEY, else <ai-brain path>/.env where the path comes from
~/.claude/settings.json -> extraKnownMarketplaces["ai-brain"].source.path. The key is never printed.
Video is async and billed per second: on failure/timeout the job id is printed -- re-run with
--resume instead of re-submitting (re-submitting bills again).
"""
import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://openrouter.ai/api/v1"


def out(*a):
    try:
        print(*a, flush=True)
    except UnicodeEncodeError:
        print(*[str(x).encode("ascii", "replace").decode() for x in a], flush=True)


def die(msg, code=1):
    sys.stderr.write(msg + "\n")
    sys.exit(code)


def parse_env(path):
    vals = {}
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            if k.startswith("export "):
                k = k[7:].strip()
            v = v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            vals[k] = v
    return vals


def env_file_path():
    settings = os.path.join(os.path.expanduser("~"), ".claude", "settings.json")
    try:
        with open(settings, encoding="utf-8-sig") as f:
            p = json.load(f)["extraKnownMarketplaces"]["ai-brain"]["source"]["path"]
        return os.path.join(p, ".env")
    except (OSError, KeyError, TypeError, ValueError):
        return None


def get_key():
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if key:
        return key
    env_path = env_file_path()
    try:
        key = parse_env(env_path).get("OPENROUTER_API_KEY", "").strip()
        if key:
            return key
    except (OSError, TypeError, ValueError):
        pass
    die("OPENROUTER_API_KEY not found. Set the env var, or put OPENROUTER_API_KEY=... in "
        + (env_path or "<ai-brain path>\\.env (path from ~/.claude/settings.json "
           "extraKnownMarketplaces.ai-brain.source.path)"))


def headers(key, json_body=False):
    h = {"Authorization": "Bearer " + key, "HTTP-Referer": "https://github.com/lotoras/ai-brain",
         "X-Title": "ai-brain"}
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def request(key, method, path, body=None, raw=False):
    url = path if path.startswith("http") else BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers=headers(key, body is not None))
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            payload = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        die("HTTP %s from %s %s\n%s" % (e.code, method, path, detail))
    except urllib.error.URLError as e:
        die("Network error on %s %s: %s" % (method, path, e.reason))
    return payload if raw else json.loads(payload.decode("utf-8"))


def to_url(ref):
    if ref.startswith(("http://", "https://")):
        return ref
    if not os.path.isfile(ref):
        die("Reference image not found: " + ref)
    mime = mimetypes.guess_type(ref)[0] or "image/png"
    with open(ref, "rb") as f:
        return "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))


def img_part(ref, **extra):
    d = {"type": "image_url", "image_url": {"url": to_url(ref)}}
    d.update(extra)
    return d


def read_prompt(args):
    if args.prompt_file:
        with open(args.prompt_file, encoding="utf-8-sig") as f:
            return f.read().strip()
    if args.prompt:
        return args.prompt
    die("Provide --prompt or --prompt-file.")


def items(resp):
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        for k in ("data", "models"):
            if isinstance(resp.get(k), list):
                return resp[k]
    return []


def cap(name, default):
    raw = os.environ.get(name, "").strip()
    if not raw:
        try:
            raw = parse_env(env_file_path()).get(name, "").strip()
        except (OSError, TypeError, ValueError):
            raw = ""
    try:
        return float(raw) if raw else float(default)
    except ValueError:
        die("%s must be a number, got %r" % (name, raw))


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def get_budget(key):
    b = {"daily": None, "monthly": None, "key_left": None, "key_limit": None, "credits": None}
    try:
        d = request_soft(key, "/key").get("data") or {}
        b.update(daily=num(d.get("usage_daily")), monthly=num(d.get("usage_monthly")),
                 key_limit=num(d.get("limit")), key_left=num(d.get("limit_remaining")))
    except (RuntimeError, AttributeError):
        pass
    try:
        d = request_soft(key, "/credits").get("data") or {}
        b["credits"] = num(d.get("total_credits")) - num(d.get("total_usage"))
    except (RuntimeError, AttributeError, TypeError):
        pass
    return b


def find_model(key, path, model):
    try:
        ms = items(request_soft(key, path))
    except RuntimeError:
        return None
    return next((m for m in ms if isinstance(m, dict) and model in
                 (m.get("id"), m.get("slug"), m.get("name"))), None)


def estimate_video(key, model, duration, resolution, audio):
    """Return (cost_usd or None, notes list)."""
    entry = find_model(key, "/videos/models", model)
    if entry is None:
        return None, ["pricing unavailable for %s" % model]
    skus = entry.get("pricing_skus") or {}
    notes = []
    sd = entry.get("supported_durations")
    if sd and duration not in sd:
        notes.append("warning: duration %ss not in supported_durations %s" % (duration, sd))
    base = "duration_seconds_" + ("with_audio" if audio else "without_audio")
    res = (resolution or "").lower()
    sku = base
    if res in ("4k", "2160p"):
        sku = base + "_4k"
    elif res == "720p" and base + "_720p" in skus:
        sku = base + "_720p"
    price = num(skus.get(sku))
    if price is None:
        price = num(skus.get(base))
    if price is None:
        return None, notes + ["raw pricing_skus: " + json.dumps(skus)]
    return price * duration, notes


def estimate_image(key, model, n, n_refs):
    """Return (cost_usd or None, notes list)."""
    try:
        eps = request_soft(key, "/images/models/%s/endpoints" % model).get("endpoints") or []
        pricing = (eps[0] or {}).get("pricing") or []
    except (RuntimeError, AttributeError, IndexError):
        return None, ["pricing unavailable for %s" % model]
    by = {p.get("billable"): p for p in pricing if isinstance(p, dict)}
    o = by.get("output_image")
    c = num((o or {}).get("cost_usd"))
    if c is None:
        return None, ["raw pricing: " + json.dumps(pricing)]
    if o.get("unit") == "token":
        total = c * 1290 * n
        i = by.get("input_image")
        if n_refs and i and num(i.get("cost_usd")) is not None:
            total += num(i["cost_usd"]) * 1290 * n_refs
        return total, []
    return c * n, []


def money(x):
    return "unknown" if x is None else "$%.2f" % x


def gate(key, args, what, est, notes):
    """Print the COST ESTIMATE block; exit 3 on dry run, 4 when a limit blocks."""
    per_call = args.max_cost if args.max_cost is not None else cap("OPENROUTER_MAX_COST_PER_CALL", 3)
    daily_limit = cap("OPENROUTER_DAILY_LIMIT", 10)
    b = get_budget(key)
    out("COST ESTIMATE")
    out("  model:    %s" % args.model)
    out("  what:     %s" % what)
    out("  estimate: %s" % ("~" + money(est) if est is not None else "unknown -- " + "; ".join(notes)))
    if est is not None:
        for n in notes:
            out("  " + n)
    out("  today spent %s of daily limit %s; per-call cap %s%s; credits left %s; key limit remaining %s"
        % (money(b["daily"]), money(daily_limit), money(per_call),
           " (--max-cost)" if args.max_cost is not None else "", money(b["credits"]),
           money(b["key_left"]) if b["key_limit"] is not None else "none"))
    if not args.yes:
        out("DRY RUN -- nothing generated. Re-run with --yes after the user approves.")
        sys.exit(3)
    why = []
    if est is None and args.max_cost is None:
        why.append("estimate unknown; pass --max-cost USD to accept an unpriced call")
    if b["daily"] is None and args.max_cost is None:
        why.append("today's usage unknown (/key failed); pass --max-cost USD to proceed")
    if est is not None:
        if est > per_call:
            why.append("estimate %s exceeds per-call cap %s" % (money(est), money(per_call)))
        if b["daily"] is not None and b["daily"] + est > daily_limit:
            why.append("today's spend %s + estimate %s exceeds daily limit %s"
                       % (money(b["daily"]), money(est), money(daily_limit)))
        if b["credits"] is not None and est > b["credits"]:
            why.append("estimate exceeds credits left %s" % money(b["credits"]))
        if b["key_limit"] is not None and b["key_left"] is not None and est > b["key_left"]:
            why.append("estimate exceeds key limit remaining %s" % money(b["key_left"]))
    if why:
        sys.stderr.write("REFUSED:\n  " + "\n  ".join(why) + "\n")
        sys.exit(4)


def cmd_budget(args, key):
    b = get_budget(key)
    out("today spent:      %s" % money(b["daily"]))
    out("month spent:      %s" % money(b["monthly"]))
    out("credits left:     %s" % money(b["credits"]))
    out("key limit left:   %s" % (money(b["key_left"]) if b["key_limit"] is not None else "no key limit"))
    out("daily limit:      %s" % money(cap("OPENROUTER_DAILY_LIMIT", 10)))
    out("per-call cap:     %s" % money(cap("OPENROUTER_MAX_COST_PER_CALL", 3)))


def mentions(obj, needle):
    return needle in json.dumps(obj).lower()


def cmd_models(args, key):
    path = "/images/models" if args.kind == "image" else "/videos/models"
    for m in items(request(key, "GET", path)):
        if not isinstance(m, dict):
            out(m)
            continue
        mid = m.get("id") or m.get("slug") or m.get("name") or "?"
        price = m.get("pricing")
        line = str(mid)
        if price:
            line += "  pricing=" + json.dumps(price)
        if args.kind == "video":
            line += "  last_frame=" + ("yes" if mentions(m, "last_frame") else "unlisted")
        out(line)


def cmd_image(args, key):
    prompt = read_prompt(args)
    est, notes = estimate_image(key, args.model, args.n, len(args.ref))
    what = "%d image%s + %d ref%s" % (args.n, "" if args.n == 1 else "s", len(args.ref),
                                      "" if len(args.ref) == 1 else "s")
    gate(key, args, what, est, notes)
    body = {"model": args.model, "prompt": prompt, "n": args.n}
    if args.ref:
        body["input_references"] = [img_part(r) for r in args.ref]
    if args.aspect:
        body["aspect_ratio"] = args.aspect
    if args.resolution:
        body["resolution"] = args.resolution
    if args.seed is not None:
        body["seed"] = args.seed
    resp = request(key, "POST", "/images", body)
    data = resp.get("data") or []
    if not data:
        die("No image returned: " + json.dumps(resp)[:500])
    root, ext = os.path.splitext(args.out)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    for i, d in enumerate(data):
        path = args.out if len(data) == 1 else "%s-%d%s" % (root, i + 1, ext)
        with open(path, "wb") as f:
            f.write(base64.b64decode(d["b64_json"]))
        out("saved", path)
    out("cost", (resp.get("usage") or {}).get("cost"), "(estimate was ~%s)" % money(est))


def check_last_support(key, model):
    try:
        ms = items(request_soft(key, "/videos/models"))
    except RuntimeError as e:
        out("warning: could not verify last_frame support (%s); continuing" % e)
        return
    entry = next((m for m in ms if isinstance(m, dict) and model in
                  (m.get("id"), m.get("slug"), m.get("name"))), None)
    if entry is None:
        out("warning: model %s not in /videos/models; continuing" % model)
    elif not mentions(entry, "last_frame"):
        ok = [m.get("id") for m in ms if isinstance(m, dict) and mentions(m, "last_frame")]
        die("Model %s does not list last_frame support. Models that do: %s"
            % (model, ", ".join(str(x) for x in ok) or "none listed"))


def request_soft(key, path):
    req = urllib.request.Request(BASE + path, headers=headers(key))
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        raise RuntimeError(str(e))


def poll_and_download(key, job, args, est=None):
    deadline = time.time() + args.timeout
    while True:
        st = request(key, "GET", "/videos/" + job)
        status = st.get("status")
        out("status", status)
        if status == "completed":
            break
        if status == "failed":
            out("job id:", job)
            die("Video failed: " + json.dumps(st.get("error") or st)[:500]
                + "\nRe-poll with: video --resume " + job + " --out <PATH> (do not re-submit)")
        if time.time() > deadline:
            out("job id:", job)
            die("Timed out waiting. Re-poll with: video --resume " + job
                + " --out <PATH> (do not re-submit; it bills again)")
        time.sleep(args.poll)
    content = request(key, "GET", "/videos/%s/content?index=0" % job, raw=True)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "wb") as f:
        f.write(content)
    out("saved", args.out)
    usage = st.get("usage") or {}
    out("cost", usage.get("cost", st.get("cost")),
        "(estimate was ~%s)" % money(est) if est is not None else "")


def cmd_video(args, key):
    if args.resume:
        out("job id:", args.resume)
        return poll_and_download(key, args.resume, args)
    if not args.first:
        die("--first is required (or use --resume JOB_ID).")
    prompt = read_prompt(args)
    if args.last:
        check_last_support(key, args.model)
    est, notes = estimate_video(key, args.model, args.duration, args.resolution, args.audio)
    what = "%ss %s video, %s audio" % (args.duration, args.resolution or "default-res",
                                       "with" if args.audio else "no")
    gate(key, args, what, est, notes)
    frames = [img_part(args.first, frame_type="first_frame")]
    if args.last:
        frames.append(img_part(args.last, frame_type="last_frame"))
    body = {"model": args.model, "prompt": prompt, "duration": args.duration,
            "frame_images": frames, "generate_audio": bool(args.audio)}
    if args.aspect:
        body["aspect_ratio"] = args.aspect
    if args.resolution:
        body["resolution"] = args.resolution
    resp = request(key, "POST", "/videos", body)
    job = resp.get("id")
    if not job:
        die("No job id returned: " + json.dumps(resp)[:500])
    out("job id:", job)
    poll_and_download(key, job, args, est)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="OpenRouter image/video helper")
    sub = ap.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("models", help="list image or video models")
    m.add_argument("--kind", choices=["image", "video"], required=True)

    sub.add_parser("budget", help="show usage, credits and spend caps (free)")

    def prompt_args(p):
        p.add_argument("--prompt")
        p.add_argument("--prompt-file")
        p.add_argument("--out", required=True)
        p.add_argument("--aspect")
        p.add_argument("--resolution")
        p.add_argument("--yes", action="store_true", help="approve the estimate and generate")
        p.add_argument("--max-cost", type=float, help="per-call cap override in USD")

    i = sub.add_parser("image", help="generate an image")
    prompt_args(i)
    i.add_argument("--model", default="google/gemini-2.5-flash-image")
    i.add_argument("--ref", action="append", default=[], help="reference image (repeatable)")
    i.add_argument("--seed", type=int)
    i.add_argument("--n", type=int, default=1)

    v = sub.add_parser("video", help="generate a video (async) or --resume a job")
    prompt_args(v)
    v.add_argument("--model", default="google/veo-3.1")
    v.add_argument("--first", help="first-frame image")
    v.add_argument("--last", help="last-frame image")
    v.add_argument("--duration", type=int, default=4)
    v.add_argument("--audio", action="store_true", help="generate audio (default off; ~2x cost)")
    v.add_argument("--poll", type=int, default=10)
    v.add_argument("--timeout", type=int, default=900)
    v.add_argument("--resume", metavar="JOB_ID", help="only poll + download an existing job")

    args = ap.parse_args()
    key = get_key()
    {"models": cmd_models, "image": cmd_image, "video": cmd_video,
     "budget": cmd_budget}[args.cmd](args, key)


if __name__ == "__main__":
    main()
