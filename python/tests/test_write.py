import hashlib
import json
import unittest
from pathlib import Path

import flexova

ROOT = Path(__file__).resolve().parents[2]
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'


def sample(**overrides):
    doc = {
        "identifier": "urn:uuid:3f1c2b7e-0000-4000-8000-000000000001",
        "title": "Field Service Manual",
        "language": "en",
        "modified": "2026-11-02T00:00:00Z",
        "authors": ["EagleMind"],
        "tokens": {"color": {"accent": {"light": "#0b5fff", "dark": "#7aa7ff"}}, "measure": 70},
        "chapters": [
            {"title": "Before you start", "body": '<section id="s1"><h1 id="h1">Before you start</h1>'
                '<p>Isolate the unit. See <a href="02.xhtml#specs">specifications</a>.</p></section>'},
            {"title": "Specifications", "body": '<section id="specs"><h1 id="h2">Specifications</h1>'
                '<figure id="f1"><img src="../assets/chart.svg" alt="Bar chart" width="10" height="10"/></figure>'
                '<p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>=</mo><mn>2</mn></math></p></section>'},
        ],
        "assets": [{"path": "assets/chart.svg", "media_type": "image/svg+xml", "data": SVG}],
    }
    doc.update(overrides)
    return doc


class WriteTest(unittest.TestCase):
    def test_output_is_valid_and_byte_identical_across_builds(self):
        first, second = flexova.write(sample()), flexova.write(sample())
        self.assertEqual(hashlib.sha256(first).hexdigest(), hashlib.sha256(second).hexdigest())
        report = flexova.validate(first)
        self.assertTrue(report.valid)
        self.assertEqual(report.codes, [])

    def test_refuses_to_emit_an_invalid_package(self):
        bad = sample(chapters=[{"title": "x", "body": "<div><p>not in the profile</p></div>"}])
        with self.assertRaises(flexova.FlexovaError) as ctx:
            flexova.write(bad)
        self.assertIn("PRF_UNKNOWN_ELEMENT", ctx.exception.report.codes)

    def test_rejects_malformed_input(self):
        with self.assertRaises(ValueError):
            flexova.write(sample(title=""))
        with self.assertRaises(ValueError):
            flexova.write(sample(chapters=[]))
        with self.assertRaises(ValueError):
            flexova.write(sample(assets=[{"path": "nav.xhtml", "media_type": "image/png", "data": b""}]))

    def test_right_to_left_and_custom_nav_title(self):
        pkg = flexova.write(sample(language="ar", direction="rtl", nav_title="المحتويات"))
        self.assertTrue(flexova.validate(pkg).valid)


class CompileTokensTest(unittest.TestCase):
    def test_golden_vectors(self):
        vectors = json.loads((ROOT / "conformance" / "vectors" / "compile-tokens.json").read_text("utf-8"))
        for case in vectors["cases"]:
            with self.subTest(case=case["name"]):
                self.assertEqual(flexova.compile_tokens(case["tokens"]), case["css"])


if __name__ == "__main__":
    unittest.main()
