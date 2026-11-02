"""Flexova: write and validate .flexova documents with only the Python standard library.

Naming constants must match ``spec/constants.json`` (enforced by tests/test_constants.py).
"""

from ._report import FlexovaError, Issue, Report
from ._sign import Verification, generate_key, jwk_thumbprint, sign, verify
from ._tokens import compile_tokens
from ._validate import validate
from ._write import write

__version__ = "0.0.0"

FORMAT_NAME = "Flexova"
FILE_EXTENSION = ".flexova"
HTML_EXTENSION = ".flexova.html"
MEDIA_TYPE = "application/vnd.flexova+zip"
CONTAINER_MIMETYPE = "application/epub+zip"
PROFILE_VERSION = "1.0"
# PLACEHOLDER until the project domain is registered (see docs/STATUS.md).
NAMESPACE_URI = "https://flexova.example/ns/1.0#"
MANIFEST_PATH = "META-INF/flexova.json"
VIEWER_ELEMENT = "flexova-viewer"

__all__ = [
    "validate",
    "write",
    "compile_tokens",
    "sign",
    "verify",
    "generate_key",
    "jwk_thumbprint",
    "Report",
    "Issue",
    "FlexovaError",
    "Verification",
]
