"""The shared conformance suite: this implementation must report exactly the expected codes per fixture."""

import json
import unittest
from pathlib import Path

import flexova

ROOT = Path(__file__).resolve().parents[2]
SUITE = ROOT / "conformance"
EXPECTED = json.loads((SUITE / "expected.json").read_text("utf-8"))["fixtures"]


class ConformanceTest(unittest.TestCase):
    def test_suite_is_not_empty(self):
        counts = {c: sum(1 for k in EXPECTED if k.startswith(c + "/")) for c in ("valid", "invalid", "hostile")}
        self.assertGreaterEqual(counts["valid"], 15)
        self.assertGreaterEqual(counts["invalid"], 25)
        self.assertGreaterEqual(counts["hostile"], 10)

    def test_every_fixture(self):
        for rel, want in EXPECTED.items():
            with self.subTest(fixture=rel):
                report = flexova.validate((SUITE / rel).read_bytes())
                self.assertEqual(report.codes, want["codes"], [f"{i.code} {i.path}: {i.message}" for i in report.issues])
                self.assertEqual(report.valid, want["valid"])


class SpecSyncTest(unittest.TestCase):
    def test_bundled_spec_data_matches_spec(self):
        pairs = {
            "constants.json": ROOT / "spec" / "constants.json",
            "errors.json": ROOT / "spec" / "errors.json",
            "profile-1.0.json": ROOT / "spec" / "profile" / "profile-1.0.json",
            "signature.json": ROOT / "spec" / "signature.json",
        }
        for name, source in pairs.items():
            with self.subTest(file=name):
                bundled = ROOT / "python" / "src" / "flexova" / "_data" / name
                self.assertEqual(bundled.read_bytes(), source.read_bytes(), "run `pnpm sync:spec`")


if __name__ == "__main__":
    unittest.main()
