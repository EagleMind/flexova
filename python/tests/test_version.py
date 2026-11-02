"""The package version matches pyproject.toml."""

import re
import unittest
from pathlib import Path

import flexova

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


class VersionTest(unittest.TestCase):
    def test_version_matches_pyproject(self):
        match = re.search(r'^version = "([^"]+)"$', PYPROJECT.read_text("utf-8"), re.MULTILINE)
        self.assertIsNotNone(match)
        self.assertEqual(flexova.__version__, match.group(1))


if __name__ == "__main__":
    unittest.main()
