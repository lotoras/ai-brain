#!/usr/bin/env python3
"""Generate ONE image through the Codex CLI's built-in image_gen tool (ChatGPT subscription).
Default image route for media-gen; run one at a time (never concurrent runs).

    python codex_image.py (--prompt TEXT | --prompt-file F) --out PATH.png
                          [--ref IMG ...] [--model MODEL] [--timeout 600]
                          [--transparent] [--force]

No API key, no credits, no cost gate: Codex must be logged in with ChatGPT and have the
`image_generation` feature (check: `codex features list`). Typical run: 60-150 s.
--ref attaches reference images (`codex exec -i`) that Codex is told to match in style/composition.
Codex runs in the --out folder (workspace-write sandbox) and copies the result to --out; if it
does not, the newest new file in ~/.codex/generated_images is copied instead.
Never overwrites an existing --out unless --force. Prints `SAVED <path> <w>x<h> <mode>`.
Exit codes: 0 ok, 1 failure/timeout/invalid image, 2 bad usage (argparse).
"""
import argparse
import os
import shutil
import subprocess
import sys

GEN_DIR = os.path.join(os.path.expanduser("~"), ".codex", "generated_images")


def out(*a):
    try:
        print(*a, flush=True)
    except UnicodeEncodeError:
        print(*[str(x).encode("ascii", "replace").decode() for x in a], flush=True)


def die(msg, code=1):
    sys.stderr.write(msg + "\n")
    sys.exit(code)


def snapshot():
    snap = {}
    for root, _dirs, files in os.walk(GEN_DIR):
        for f in files:
            p = os.path.join(root, f)
            try:
                snap[p] = os.path.getmtime(p)
            except OSError:
                pass
    return snap


def read_prompt(args):
    if args.prompt_file:
        with open(args.prompt_file, encoding="utf-8-sig") as f:
            return f.read().strip()
    return args.prompt.strip()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Codex CLI image helper (ChatGPT subscription). Default image route for media-gen; run one at a time.")
    ap.add_argument("--prompt")
    ap.add_argument("--prompt-file")
    ap.add_argument("--ref", action="append", default=[], help="reference image (repeatable)")
    ap.add_argument("--out", required=True, help="output .png path")
    ap.add_argument("--model", help="passed to codex as -m")
    ap.add_argument("--timeout", type=int, default=600)
    ap.add_argument("--transparent", action="store_true", help="ask for a transparent background")
    ap.add_argument("--force", action="store_true", help="overwrite an existing --out")
    args = ap.parse_args()
    if bool(args.prompt) == bool(args.prompt_file):
        die("Provide exactly one of --prompt or --prompt-file.", 2)
    prompt = read_prompt(args)
    if not prompt:
        die("Empty prompt.", 2)

    out_path = os.path.abspath(args.out)
    if not out_path.lower().endswith(".png"):
        die("--out must be a .png path.", 2)
    if os.path.exists(out_path) and not args.force:
        die("Refusing to overwrite existing %s (use --force)." % out_path)
    refs = []
    for r in args.ref:
        rp = os.path.abspath(r)
        if not os.path.isfile(rp):
            die("Reference image not found: " + r)
        refs.append(rp)
    workdir = os.path.dirname(out_path)
    os.makedirs(workdir, exist_ok=True)
    if os.path.exists(out_path):
        os.remove(out_path)

    codex = shutil.which("codex")
    if not codex:
        die("codex CLI not found on PATH (install it and log in with ChatGPT).")

    instr = ["Use your built-in image_gen tool to generate exactly ONE image: " + prompt]
    if refs:
        instr.append("The attached image(s) are style/composition references: match their "
                     "subject, lighting, palette and backdrop as closely as the prompt allows.")
    if args.transparent:
        instr.append("Transparent background, preserve alpha (PNG with real transparency).")
    instr.append("Then copy the generated file to exactly this absolute path (convert to PNG if "
                 "needed): %s. Do nothing else. Finally print only that absolute path." % out_path)
    instruction = "\n".join(instr)

    cmd = [codex, "exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", workdir]
    if args.model:
        cmd += ["-m", args.model]
    for r in refs:
        cmd += ["-i", r]
    # '--' ends the option list so the prompt is not swallowed by the variadic -i.
    # The prompt goes in via stdin ('-'): on Windows codex resolves to a .cmd shim, which
    # truncates a command-line argument at the first newline.
    cmd += ["--", "-"]

    before = snapshot()
    out("running codex (%d ref%s)..." % (len(refs), "" if len(refs) == 1 else "s"))
    try:
        proc = subprocess.run(cmd, input=instruction, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=args.timeout)
        rc, tail = proc.returncode, (proc.stdout + "\n" + proc.stderr)[-1500:]
    except subprocess.TimeoutExpired:
        rc, tail = None, ""
        sys.stderr.write("codex timed out after %ds; checking for a generated file anyway.\n"
                         % args.timeout)

    if not os.path.isfile(out_path):
        after = snapshot()
        new = [p for p, m in after.items() if before.get(p) != m
               and p.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
        if new:
            newest = max(new, key=lambda p: after[p])
            try:
                from PIL import Image
                Image.open(newest).convert("RGBA" if args.transparent else "RGB").save(out_path, "PNG")
            except Exception:
                shutil.copyfile(newest, out_path)
            out("fallback: copied", newest)
    if not os.path.isfile(out_path):
        if rc is None:
            die("Timed out after %ds and no image was produced." % args.timeout)
        die("Codex exit %s and no image produced.\n%s" % (rc, tail))

    try:
        from PIL import Image
        with Image.open(out_path) as im:
            im.load()
            w, h, mode = im.width, im.height, im.mode
    except Exception as e:
        die("Output is not a valid image (%s): %s" % (e, out_path))
    out("SAVED %s %dx%d %s" % (out_path, w, h, mode))


if __name__ == "__main__":
    main()
