#!/usr/bin/env python3
"""Rewrite the omnibox keyword in manifest.json and repackage the extension."""

import argparse
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
MANIFEST = HERE / "manifest.json"
ZIP_NAME = "repo-picker.zip"
PACKAGED = ["manifest.json", "background.js", "options.html", "options.js", "capture.js",
            "popup.html", "popup.js", "icon.svg", "orgs.js", "https-url.js"]
VALID = re.compile(r"^[^\s\"'<>]+$")
DESCRIPTION = "Type {kw} in the address bar, then a repo name, to jump straight to it."


def bump_patch(version):
    parts = version.split(".")
    while len(parts) < 3:
        parts.append("0")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("keyword", nargs="?", help="new address bar keyword")
    parser.add_argument("--keep-version", action="store_true",
                        help="do not bump the patch version")
    parser.add_argument("--no-zip", action="store_true",
                        help="do not rebuild repo-picker.zip")
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text())
    current = manifest["omnibox"]["keyword"]

    if not args.keyword:
        print(f"current keyword: {current}")
        print(f"usage: {pathlib.Path(sys.argv[0]).name} <new-keyword>")
        return 1

    keyword = args.keyword
    if not VALID.match(keyword):
        print(f"refusing {keyword!r}: no whitespace, quotes or angle brackets", file=sys.stderr)
        return 1
    if keyword == current:
        print(f"keyword is already {current}")
        return 0
    if len(keyword) > 10:
        print(f"note: {keyword!r} is long for something you type before every search")

    manifest["omnibox"]["keyword"] = keyword
    manifest["description"] = DESCRIPTION.format(kw=keyword)
    if not args.keep_version:
        manifest["version"] = bump_patch(manifest["version"])

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"keyword: {current} -> {keyword}  (version {manifest['version']})")

    if not args.no_zip:
        target = HERE / ZIP_NAME
        target.unlink(missing_ok=True)
        subprocess.run(["zip", "-q", "-FS", ZIP_NAME, *PACKAGED], cwd=HERE, check=True)
        print(f"repackaged {target}")

    print("reload the add-on in about:debugging, or re-sign the zip for a permanent install")
    return 0


if __name__ == "__main__":
    sys.exit(main())
