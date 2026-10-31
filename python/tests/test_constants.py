import json
import unittest
from pathlib import Path

import flexova

SPEC = json.loads((Path(__file__).resolve().parents[2] / "spec" / "constants.json").read_text("utf-8"))


class ConstantsTest(unittest.TestCase):
    def test_match_spec_constants(self):
        """Python constants equal spec/constants.json, the single source of truth."""
        actual = {
            "formatName": flexova.FORMAT_NAME,
            "fileExtension": flexova.FILE_EXTENSION,
            "htmlExtension": flexova.HTML_EXTENSION,
            "mediaType": flexova.MEDIA_TYPE,
            "containerMimetype": flexova.CONTAINER_MIMETYPE,
            "profileVersion": flexova.PROFILE_VERSION,
            "namespaceUri": flexova.NAMESPACE_URI,
            "manifestPath": flexova.MANIFEST_PATH,
            "viewerElement": flexova.VIEWER_ELEMENT,
        }
        expected = {k: v for k, v in SPEC.items() if not k.startswith("$")}
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
