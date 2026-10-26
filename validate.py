#!/usr/bin/env python3
"""HKL LCD PIDS — offline validation.

1. static checks on hklcd.js (Rhino pitfalls that have bitten this project before)
2. run every harness scenario through the real script (Rhino 1.9.1 + Java AWT)
3. check the produced PNGs: size, colours, no recorded script error
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "assets" / "jsblock" / "scripts" / "hklcd.js"
HARNESS = ROOT / "harness"
SCEN = HARNESS / "scenarios"
OUT = HARNESS / "out"
PRELUDE = HARNESS / "prelude.js"

JAVA_CANDIDATES = [
    os.environ.get("JCM_TEST_JAVA", ""),
    r"C:\Program Files\Zulu\zulu-21\bin\java.exe",
    r"C:\Program Files\Java\jdk-21\bin\java.exe",
    shutil.which("java") or "",
]
RHINO_CANDIDATES = [
    ROOT.parent / "rhino" / "rhino-1.9.1.jar",
    ROOT / "harness" / "rhino-1.9.1.jar",
]

failures = []
checks = 0


def check(cond, msg):
    global checks
    checks += 1
    if not cond:
        failures.append(msg)
        print("  FAIL  " + msg)
    else:
        print("  ok    " + msg)


def strip_js(src):
    """Remove comments and string/template literals, for bracket counting."""
    out = []
    i, n = 0, len(src)
    state = None  # None, 'line', 'block', 'str', 'tpl'
    quote = ""
    while i < n:
        c = src[i]
        nx = src[i + 1] if i + 1 < n else ""
        if state is None:
            if c == "/" and nx == "/":
                state = "line"; i += 2; continue
            if c == "/" and nx == "*":
                state = "block"; i += 2; continue
            if c in "'\"":
                state = "str"; quote = c; i += 1; continue
            if c == "`":
                state = "tpl"; i += 1; continue
            out.append(c); i += 1; continue
        if state == "line":
            if c == "\n":
                state = None; out.append(c)
            i += 1; continue
        if state == "block":
            if c == "*" and nx == "/":
                state = None; i += 2; continue
            i += 1; continue
        if state == "str":
            if c == "\\":
                i += 2; continue
            if c == quote:
                state = None
            i += 1; continue
        if state == "tpl":
            if c == "\\":
                i += 2; continue
            if c == "`":
                state = None
            i += 1; continue
    return "".join(out)


def bad_derive_font(code):
    """Find deriveFont() calls without a comma at the top level of their args."""
    bad = []
    for m in re.finditer(r"deriveFont\s*\(", code):
        i, depth, args = m.end(), 1, ""
        while i < len(code) and depth > 0:
            ch = code[i]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if depth > 0:
                args += ch
            i += 1
        d, has_comma = 0, False
        for ch in args:
            if ch in "([{":
                d += 1
            elif ch in ")]}":
                d -= 1
            elif ch == "," and d == 0:
                has_comma = True
        if not has_comma:
            bad.append(args.strip())
    return bad


def static_checks():
    print("[1] static checks")
    src = SCRIPT.read_text(encoding="utf-8")
    code = strip_js(src)

    for fn in ("create", "render", "dispose"):
        check(re.search(r"\bfunction\s+" + fn + r"\s*\(", code) is not None,
              f"entry point {fn}() exists")

    # Rhino: const/let are function-scoped and duplicate declarations are fatal.
    bad_block = [ln for ln in src.splitlines()
                 if re.match(r"^\s+(const|let)\s+", ln)]
    check(not bad_block, f"no block-scoped const/let inside functions ({len(bad_block)})")

    check("=>" not in code, "no arrow functions")
    check(re.search(r"new\s+Color\s*\([^)]*,", code) is None,
          "no 3-argument new Color()")
    check(not bad_derive_font(code), "no single-argument deriveFont()")
    check(".forEach(" not in code, "no forEach()")
    check(".length()" not in code, "no Java-list .length()")

    for opener, closer in (("{", "}"), ("(", ")"), ("[", "]")):
        check(code.count(opener) == code.count(closer),
              f"balanced {opener}{closer} ({code.count(opener)}/{code.count(closer)})")

    # preset registration
    cfg = ROOT / "assets" / "jsblock" / "joban_custom_resources.json"
    doc = json.loads(cfg.read_text(encoding="utf-8"))
    check("pids_images" in doc and len(doc["pids_images"]) >= 1, "pids_images preset present")
    preset = doc["pids_images"][0]
    check(preset.get("id") == "hklcd", "preset id = hklcd")
    check(preset.get("scriptFiles") == ["jsblock:scripts/hklcd.js"], "scriptFiles points at hklcd.js")
    thumb = ROOT / "assets" / "jsblock" / "textures" / "pids" / "hklcd" / "thumbnail.png"
    check(thumb.exists(), "thumbnail exists")

    meta = json.loads((ROOT / "pack.mcmeta").read_text(encoding="utf-8"))
    check(meta["pack"]["pack_format"] == 15, "pack_format = 15")
    check(meta["pack"]["supported_formats"]["min_inclusive"] <= 6, "supports old pack formats")
    check((ROOT / "pack.png").exists(), "pack.png exists")

    js_bytes = SCRIPT.stat().st_size
    check(js_bytes > 20000, f"script size sane ({js_bytes} bytes)")


def find_java():
    for c in JAVA_CANDIDATES:
        if c and Path(c).exists():
            return c
    return None


def find_rhino():
    for c in RHINO_CANDIDATES:
        if c.exists():
            return c
    return None


def render_all(java, rhino):
    print("[2] rendering scenarios through Rhino")
    OUT.mkdir(parents=True, exist_ok=True)
    cp = str(HARNESS) + os.pathsep + str(rhino)
    results = {}
    for scen in sorted(SCEN.glob("*.json")):
        name = scen.stem
        png = OUT / (name + ".png")
        if png.exists():
            png.unlink()
        proc = subprocess.run(
            [java, "-cp", cp, "RhinoPids", str(PRELUDE), str(SCRIPT), str(scen), str(png)],
            cwd=str(ROOT), capture_output=True, text=True, timeout=120,
        )
        ok = proc.returncode == 0 and png.exists()
        check(ok, f"render {name}" + ("" if ok else f" (exit {proc.returncode})"))
        if not ok:
            tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-3:]
            for line in tail:
                print("        " + line)
            continue
        meta_path = Path(str(png) + ".json")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        check(meta.get("scriptError") is None, f"{name}: no script exception")
        check(meta.get("recordedError") is None, f"{name}: no captured error screen")
        check(meta.get("uploads", 0) >= 1, f"{name}: texture uploaded")
        doc = json.loads(scen.read_text(encoding="utf-8"))
        w, h = doc["size"]
        img = Image.open(png)
        check(img.size == (w * 8, h * 8), f"{name}: texture is {w*8}x{h*8} (got {img.size[0]}x{img.size[1]})")
        results[name] = (img.convert("RGB"), meta)
    return results


def colour_checks(renders):
    print("[3] pixel spot checks")
    def count(img, pred):
        px = img.load()
        w, h = img.size
        n = 0
        for y in range(0, h, 2):
            for x in range(0, w, 2):
                if pred(px[x, y]):
                    n += 1
        return n * 4

    def near(c, t, tol=40):
        return all(abs(c[i] - t[i]) <= tol for i in range(3))

    img, _ = renders["map_local_cn"]
    total = img.size[0] * img.size[1]
    pink = count(img, lambda c: c[0] > 200 and 90 < c[1] < 180 and 90 < c[2] < 180)
    blue = count(img, lambda c: c[2] > 70 and c[2] > c[0] + 30 and c[1] < 110 and c[0] < 70)
    dark = count(img, lambda c: sum(c) < 260)
    check(pink / total > 0.02, "map: route line/bubbles present")
    check(blue / total > 0.01, "map: clock/badge blue present")
    check(dark / total > 0.05, "map: text present")

    img, _ = renders["warn_cn"]
    total = img.size[0] * img.size[1]
    yellow = count(img, lambda c: c[0] > 190 and 150 < c[1] < 215 and c[2] < 110)
    check(yellow / total > 0.15, "warning: yellow panel covers the middle")

    img, _ = renders["door_cn"]
    total = img.size[0] * img.size[1]
    light = count(img, lambda c: sum(c) > 690)
    dark = count(img, lambda c: sum(c) < 260)
    check(light / total > 0.3, "door: light body present")
    check(dark / total > 0.02, "door: warning text present")

    img, _ = renders["list_en"]
    dark_gray = count(img, lambda c: near(c, (60, 60, 60), 25))
    blue = count(img, lambda c: c[2] > 120 and c[2] > c[0] + 50)
    check(dark_gray > 500, "list: Local badge colour")
    check(blue > 500, "list: Rapid badge colour")

    img, _ = renders["empty"]
    dark = count(img, lambda c: sum(c) < 260)
    check(dark > 1000, "empty: message text present")

    for name in ("size_40x20_list", "size_90x46_list", "size_136x76_map", "size_272x152_map"):
        if name in renders:
            check(True, f"multi-size render ok: {name}")


def main():
    print("HKL LCD PIDS validation")
    static_checks()
    java, rhino = find_java(), find_rhino()
    if not java or not rhino:
        print(f"  SKIP  render suite (java={java}, rhino={rhino})")
        failures.append("render suite could not run")
    else:
        renders = render_all(java, rhino)
        colour_checks(renders)

    print()
    if failures:
        print(f"FAILED {len(failures)} / {checks} checks")
        for f in failures:
            print("  - " + f)
        return 1
    print(f"PASSED {checks} checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
