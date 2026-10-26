#!/usr/bin/env python3
"""Build the resource pack zip (root = pack.mcmeta)."""
import os
import pathlib
import zipfile

FILES = [
    "pack.mcmeta",
    "pack.png",
    "preview.png",
    "README.md",
    "README_EN.md",
    "LICENSE",
    "NOTICE.md",
    "assets/jsblock/joban_custom_resources.json",
    "assets/jsblock/scripts/hklcd.js",
    "assets/jsblock/textures/pids/hklcd/thumbnail.png",
    "assets/jsblock/textures/pids/hklcd/sp1900.png",
    "assets/jsblock/textures/pids/hklcd/warn_triangle.png",
]

def main():
    out = pathlib.Path("HKL-LCD-PIDS.zip")
    if out.exists():
        out.unlink()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES:
            z.write(f, f)
    print("built", out, os.path.getsize(out), "bytes")

if __name__ == "__main__":
    main()
