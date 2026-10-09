"""
pixel-art / scripts / lint.py

Check a palette-indexed grid JSON for the defects that make pixel art look unclean
or badly proportioned. Reads the same file render.py renders; the optional keys
written by build.py (outline, symmetric, budget, parts) switch on more checks.

Checks
------
ERROR  colours      more colours used than --max-colors
ERROR  outline      a fill pixel touches transparency (needs the "outline" map)
WARN   orphans      a pixel with no same-colour neighbour (8-connected)
WARN   doubles      2x2 blocks made only of outline colours (outline 2 px thick)
WARN   symmetry     silhouette differs from its mirror image ("symmetric": true)
WARN   proportions  head-count, arm / torso / leg ratios, limb thickness (needs "parts")
NOTE   banding      three stacked runs of different colours with identical ends
NOTE   unused       palette entries the grid never uses

"parts" is a map of part name -> [x0, y0, x1, y1] (inclusive). Recognised names:
head, torso, arm, leg, shoulders. Anything else is only listed.

Exit code 1 when an ERROR is found, else 0.

Requires: NumPy
Usage:    python lint.py --grid sprite.grid.json [--max-colors 25]
                         [--ignore-orphans "kw"] [--heads 3-4] [--symmetric]
"""

import argparse
import json

import numpy as np

SHOW = 6            # coordinates listed per finding


def coords(mask: np.ndarray) -> str:
    ys, xs = np.where(mask)
    shown = ", ".join(f"({x},{y})" for x, y in list(zip(xs.tolist(), ys.tolist()))[:SHOW])
    more = len(xs) - SHOW
    return shown + (f" +{more} more" if more > 0 else "")


def neighbours4(mask: np.ndarray) -> list:
    padded = np.pad(mask, 1)
    return [padded[:-2, 1:-1], padded[2:, 1:-1], padded[1:-1, :-2], padded[1:-1, 2:]]


def parse_heads(value: str) -> tuple:
    try:
        lo, hi = (float(v) for v in value.replace("..", "-").split("-"))
    except ValueError:
        raise argparse.ArgumentTypeError(f"invalid --heads {value!r}, expected e.g. 3-4")
    return lo, hi


def main():
    ap = argparse.ArgumentParser(description="Lint a pixel-art grid JSON.")
    ap.add_argument("--grid", required=True, help="Grid JSON file")
    ap.add_argument("--max-colors", type=int, default=None, help="Colour limit of the style")
    ap.add_argument("--ignore-orphans", default="",
                    help="Characters allowed as single pixels (eyes, sparkles), e.g. \"kw\"")
    ap.add_argument("--heads", type=parse_heads, default=None,
                    help="Allowed total height in heads, e.g. 3-4 (overrides the grid's budget)")
    ap.add_argument("--symmetric", action="store_true",
                    help="Check silhouette symmetry even when the grid does not declare it")
    args = ap.parse_args()

    with open(args.grid, encoding="utf-8") as fh:
        data = json.load(fh)
    palette, rows = data["palette"], data["rows"]
    width = len(rows[0])
    if any(len(row) != width for row in rows):
        raise SystemExit("Grid error: rows differ in length - run render.py for the exact row.")
    grid = np.array([list(row) for row in rows])
    h, w = grid.shape
    blank = {key for key, value in palette.items() if value is None}
    solid = ~np.isin(grid, list(blank))
    findings = []                                            # (level, check, text)

    # colours
    used = sorted(set(grid[solid].tolist()))
    if args.max_colors is not None and len(used) > args.max_colors:
        findings.append(("ERROR", "colours", f"{len(used)} colours used, limit is {args.max_colors}."))
    unused = [key for key in palette if key not in blank and key not in used]
    if unused:
        findings.append(("NOTE", "unused", f"palette entries never used: {' '.join(unused)}"))

    # outline
    outline = data.get("outline") or {}
    edge_chars = set(outline.values())
    if outline:
        touches = np.zeros_like(solid)
        for near in neighbours4(solid):
            touches |= ~near
        broken = solid & touches & np.isin(grid, [c for c in outline if c not in edge_chars])
        if broken.any():
            findings.append(("ERROR", "outline",
                             f"{int(broken.sum())} fill pixels touch transparency: {coords(broken)}"))
        is_edge = np.isin(grid, list(edge_chars))
        block = is_edge[:-1, :-1] & is_edge[1:, :-1] & is_edge[:-1, 1:] & is_edge[1:, 1:]
        if block.any():
            findings.append(("WARN", "doubles",
                             f"{int(block.sum())} 2x2 outline blocks (top-left at): {coords(block)}"))

    # orphans
    padded = np.pad(grid, 1, constant_values="\0")
    same = np.zeros_like(solid)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            if (dy, dx) != (1, 1):
                same |= padded[dy:dy + h, dx:dx + w] == grid
    orphan = solid & ~same & ~np.isin(grid, list(args.ignore_orphans))
    if orphan.any():
        findings.append(("WARN", "orphans",
                         f"{int(orphan.sum())} single pixels with no same-colour neighbour: "
                         f"{coords(orphan)}"))

    # symmetry
    if args.symmetric or data.get("symmetric"):
        drift = solid != solid[:, ::-1]
        drift[:, w // 2:] = False
        if drift.any():
            findings.append(("WARN", "symmetry",
                             f"silhouette differs from its mirror at {int(drift.sum())} pixels "
                             f"(left half): {coords(drift)}"))

    # banding: three stacked runs of different colours with the same start and end
    bands = 0
    runs = []
    for y in range(h):
        line, x = {}, 0
        while x < w:
            x1 = x
            while x1 + 1 < w and grid[y, x1 + 1] == grid[y, x]:
                x1 += 1
            if solid[y, x] and x1 - x >= 2:
                line[(x, x1)] = grid[y, x]
            x = x1 + 1
        runs.append(line)
    for y in range(h - 2):
        for span, ch in runs[y].items():
            mid, low = runs[y + 1].get(span), runs[y + 2].get(span)
            if mid and low and len({ch, mid, low}) == 3:
                bands += 1
    if bands:
        findings.append(("NOTE", "banding",
                         f"{bands} places where three colour runs stack with identical ends - "
                         "stagger them unless the flat band is intended (belts, stripes)."))

    # proportions
    parts = data.get("parts") or {}
    ys, xs = np.where(solid)
    report = []
    if len(xs):
        total_h, total_w = int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1)
        report.append(f"sprite {total_w}x{total_h} on a {w}x{h} canvas")

        def size(name):
            x0, y0, x1, y1 = parts[name]
            return x1 - x0 + 1, y1 - y0 + 1

        for name in parts:
            pw, ph = size(name)
            report.append(f"{name} {pw}x{ph}")
        if "head" in parts:
            head_w, head_h = size("head")
            figure_h = int(ys.max()) - parts["head"][1] + 1      # top of head to sole, props excluded
            heads = figure_h / head_h
            report.append(f"figure {figure_h} px = {heads:.1f} heads")
            budget = args.heads
            if budget is None and isinstance((data.get("budget") or {}).get("heads"), list):
                budget = tuple(data["budget"]["heads"])
            if budget and not budget[0] <= heads <= budget[1]:
                findings.append(("WARN", "proportions",
                                 f"height is {heads:.1f} heads, budget is {budget[0]:g}-{budget[1]:g}."))
            if "shoulders" in parts:
                report.append(f"shoulders = {size('shoulders')[0] / head_w:.1f} head widths")
        if "torso" in parts:
            torso_h = size("torso")[1]
            if "arm" in parts:
                arm = max(size("arm"))
                report.append(f"arm = {arm / torso_h:.2f} x torso")
                if not 0.9 <= arm / torso_h <= 1.5:
                    findings.append(("WARN", "proportions",
                                     f"arm is {arm} px, torso {torso_h} px (ratio {arm / torso_h:.2f}); "
                                     "expected 0.9-1.5 - an arm reaches from shoulder to mid-thigh."))
            if "leg" in parts:
                leg = size("leg")[1]
                report.append(f"leg = {leg / torso_h:.2f} x torso")
                if not 0.6 <= leg / torso_h <= 1.6:
                    findings.append(("WARN", "proportions",
                                     f"leg is {leg} px, torso {torso_h} px (ratio {leg / torso_h:.2f}); "
                                     "expected 0.6-1.6."))
            if "head" in parts and torso_h < 0.7 * size("head")[1]:
                findings.append(("WARN", "proportions",
                                 f"torso ({torso_h} px) is shorter than 0.7 x head "
                                 f"({size('head')[1]} px)."))
        for name in ("arm", "leg"):
            if name in parts and min(size(name)) < 2 and max(h, w) > 16:
                findings.append(("WARN", "proportions", f"{name} is under 2 px thick."))

    print(f"Lint: {args.grid}")
    print("  " + " | ".join(report) if report else "  (empty sprite)")
    if not parts:
        print('  no "parts" in the grid - proportion checks skipped')
    for level, check, text in findings:
        print(f"  {level:<5} {check:<11} {text}")
    errors = sum(level == "ERROR" for level, _, _ in findings)
    warns = sum(level == "WARN" for level, _, _ in findings)
    print(f"  {errors} error(s), {warns} warning(s)")
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
