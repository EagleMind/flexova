#!/usr/bin/env python3
"""Run third-party validators over the valid conformance fixtures (used by .github/workflows/conformance.yml).

  python3 conformance/external_checks.py epubcheck --cmd "java -jar epubcheck.jar"
  python3 conformance/external_checks.py ace --cmd "npx --yes @daisy/ace@1.4.6"

Fixtures run through epubcheck unless expected.json marks them "epubcheck": false. Ace (accessibility)
also skips fixtures named warning-*, which are deliberately imperfect. Extra package paths given with
--also are checked too (e.g. output of the writers). Exits 1 if any check fails.
"""

import argparse
import json
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def targets(tool: str, also: list) -> list:
    fixtures = json.loads((HERE / "expected.json").read_text("utf-8"))["fixtures"]
    paths = []
    for rel, meta in fixtures.items():
        if not meta["valid"] or not meta.get("epubcheck", True):
            continue
        if tool == "ace" and Path(rel).name.startswith("warning-"):
            continue
        paths.append(HERE / rel)
    return paths + [Path(p) for p in also]


def ace_violations(report_dir: Path) -> list:
    report = json.loads((report_dir / "report.json").read_text("utf-8"))
    found = []
    for doc in report.get("assertions", []):
        for test in doc.get("assertions", []):
            if test.get("earl:result", {}).get("earl:outcome") == "fail":
                found.append(f"{doc.get('earl:testSubject', {}).get('url')}: {test.get('earl:test', {}).get('dct:title')}")
    return found


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tool", choices=["epubcheck", "ace"])
    ap.add_argument("--cmd", required=True, help="command prefix that runs the tool")
    ap.add_argument("--also", nargs="*", default=[], help="additional .flexova files to check")
    args = ap.parse_args()
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for src in targets(args.tool, args.also):
            epub = Path(tmp) / (src.stem + ".epub")
            shutil.copyfile(src, epub)
            if args.tool == "epubcheck":
                run = subprocess.run(shlex.split(args.cmd) + [str(epub)], capture_output=True, text=True)
                problems = [l for l in (run.stdout + run.stderr).splitlines() if l.startswith(("ERROR", "FATAL"))]
                ok = run.returncode == 0 and not problems
            else:
                out = Path(tmp) / (src.stem + "-ace")
                # Ace drives a headless Chrome; its first launch on a fresh runner occasionally exits non-zero
                # without a report. Retry once, and print Ace's own output if it still fails without violations.
                for _attempt in range(2):
                    shutil.rmtree(out, ignore_errors=True)
                    run = subprocess.run(shlex.split(args.cmd) + ["-f", "-s", "-o", str(out), str(epub)], capture_output=True, text=True)
                    problems = ace_violations(out) if (out / "report.json").exists() else []
                    if run.returncode == 0 or problems:
                        break
                ok = run.returncode == 0 and not problems
                if not ok and not problems:
                    problems = [f"ace exited with status {run.returncode}:"] + (run.stdout + run.stderr).strip().splitlines()[-20:]
            print(("PASS " if ok else "FAIL ") + str(src.relative_to(HERE) if src.is_relative_to(HERE) else src))
            for line in problems:
                print("    " + line)
            failures += not ok
    print(f"{args.tool}: {failures} failing package(s)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
