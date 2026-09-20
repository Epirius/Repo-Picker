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


def package(set_version=None):
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for name in PACKAGED:
        shutil.copy(HERE / name, DIST / name)

    if set_version:
        manifest_path = DIST / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["version"] = set_version
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    target = HERE / ZIP_NAME
    target.unlink(missing_ok=True)
    subprocess.run(["zip", "-q", "-FS", str(target), *PACKAGED], cwd=DIST, check=True)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-version", metavar="TAG",
                        help="fail unless manifest.json matches this tag, with or without a leading v")
    parser.add_argument("--set-version", metavar="VERSION",
                        help="override the version packaged into dist/manifest.json, "
                             "without touching the tracked manifest.json")
    args = parser.parse_args()

    current = version()
    if args.expect_version:
        wanted = args.expect_version.lstrip("v")
        if wanted != current:
            print(f"tag {args.expect_version} does not match manifest version {current}", file=sys.stderr)
            return 1

    target = package(set_version=args.set_version)
    built = args.set_version or current
    print(f"built {target.name} version {built} from {len(PACKAGED)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
