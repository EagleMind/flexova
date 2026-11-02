"""Loads the normative spec data bundled in flexova/_data (synced from spec/ by `pnpm sync:spec`)."""

import json
from importlib import resources


def _load(name: str) -> dict:
    return json.loads(resources.files("flexova").joinpath("_data").joinpath(name).read_text("utf-8"))


CONSTANTS = _load("constants.json")
ERRORS = _load("errors.json")
PROFILE = _load("profile-1.0.json")

NS = PROFILE["namespaces"]
XHTML_NS = NS["xhtml"]
EPUB_NS = NS["epub"]
MATHML_NS = NS["mathml"]
SVG_NS = NS["svg"]
XLINK_NS = NS["xlink"]
XML_NS = NS["xml"]
CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container"
OPF_NS = "http://www.idpf.org/2007/opf"
DC_NS = "http://purl.org/dc/elements/1.1/"

LIMITS = PROFILE["limits"]
MEDIA_TYPES: dict = PROFILE["mediaTypes"]
XHTML_TYPE = "application/xhtml+xml"
PHASES: list = ERRORS["phases"]
