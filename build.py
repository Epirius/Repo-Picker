#!/usr/bin/env python3
"""Copy the packaged files into dist/ and zip them for signing."""

import argparse
import json
import pathlib
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
DIST = HERE / "dist"
ZIP_NAME = "repo-picker.zip"
PACKAGED = ["manifest.json", "background.js", "options.html", "options.js", "capture.js",
            "popup.html", "popup.js", "icon.svg", "orgs.js", "https-url.js", "expiry.js"]


def version():
    return json.loads((HERE / "manifest.json").read_text())["version"]


def package():
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for name in PACKAGED:
        shutil.copy(HERE / name, DIST / name)

    target = HERE / ZIP_NAME
    target.unlink(missing_ok=True)
    subprocess.run(["zip", "-q", "-FS", str(target), *PACKAGED], cwd=DIST, check=True)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-version", metavar="TAG",
                        help="fail unless manifest.json matches this tag, with or without a leading v")
    args = parser.parse_args()

    current = version()
    if args.expect_version:
        wanted = args.expect_version.lstrip("v")
        if wanted != current:
            print(f"tag {args.expect_version} does not match manifest version {current}", file=sys.stderr)
            return 1

    target = package()
    print(f"built {target.name} version {current} from {len(PACKAGED)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
