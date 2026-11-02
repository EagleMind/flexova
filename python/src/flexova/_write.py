"""write(): build a deterministic .flexova package and refuse to return it unless it validates."""

import hashlib
import json
import re
from xml.sax.saxutils import escape, quoteattr

from ._paths import ENTRY_NAME
from ._report import FlexovaError
from ._spec import CONSTANTS, MEDIA_TYPES
from ._tokens import compile_tokens
from ._validate import validate
from ._zip import write_zip

_CHAPTER_FILE = re.compile(r"[A-Za-z0-9._-]+\.xhtml")
_RESERVED = {"package.opf", "nav.xhtml", "styles/flexova.css"}
_XMLNS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"'


def _html(lang: str, direction, title: str, css_href: str, body: str) -> bytes:
    dir_attr = f" dir={quoteattr(direction)}" if direction else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f"<html {_XMLNS} lang={quoteattr(lang)} xml:lang={quoteattr(lang)}{dir_attr}>"
        f'<head><meta charset="utf-8"/><title>{escape(title)}</title>'
        f'<link rel="stylesheet" type="text/css" href={quoteattr(css_href)}/></head>'
        f"<body>{body}</body></html>\n"
    ).encode("utf-8")


def write(doc: dict) -> bytes:
    """Build a Flexova package.

    doc keys: identifier, title, language, modified (YYYY-MM-DDThh:mm:ssZ), chapters (list of
    {title, body[, file]} where body is the XHTML inside <body>), and optionally authors (list), tokens,
    assets (list of {path, media_type, data}; path relative to OEBPS/), direction ('ltr'|'rtl'),
    nav_title, accessibility ({summary, modes, sufficient, features, hazards}).
    Raises ValueError for malformed input and FlexovaError if the result does not validate."""
    for key in ("identifier", "title", "language", "modified"):
        if not isinstance(doc.get(key), str) or not doc[key]:
            raise ValueError(f"{key} is required")
    chapters = doc.get("chapters") or []
    if not chapters:
        raise ValueError("at least one chapter is required")
    lang, direction = doc["language"], doc.get("direction")
    width = 3 if len(chapters) >= 100 else 2

    files: dict = {}
    chapter_items = []
    for i, ch in enumerate(chapters, 1):
        name = ch.get("file") or f"{i:0{width}d}.xhtml"
        if not _CHAPTER_FILE.fullmatch(name):
            raise ValueError(f"invalid chapter file name {name!r}")
        path = f"content/{name}"
        if path in files:
            raise ValueError(f"duplicate chapter file {name!r}")
        files[path] = _html(lang, direction, ch["title"], "../styles/flexova.css", ch["body"])
        chapter_items.append((f"c{i:03d}", path, ch["title"], "<math" in ch["body"]))

    asset_items = []
    for i, asset in enumerate(doc.get("assets") or [], 1):
        path, media_type = asset["path"], asset["media_type"]
        if not ENTRY_NAME.fullmatch(path) or path in _RESERVED or path.startswith("content/") or path in files:
            raise ValueError(f"invalid or reserved asset path {path!r}")
        if media_type not in MEDIA_TYPES or MEDIA_TYPES[media_type] == "content":
            raise ValueError(f"unsupported asset media type {media_type!r}")
        files[path] = bytes(asset["data"])
        asset_items.append((f"a{i:03d}", path, media_type))

    toc = "".join(f'<li><a href="{p}">{escape(t)}</a></li>' for _, p, t, _ in chapter_items)
    nav_title = doc.get("nav_title") or "Contents"
    files["nav.xhtml"] = _html(
        lang, direction, nav_title, "styles/flexova.css",
        f'<nav epub:type="toc" role="doc-toc" id="toc"><h1 id="toc-title">{escape(nav_title)}</h1><ol>{toc}</ol></nav>',
    )
    files["styles/flexova.css"] = compile_tokens(doc.get("tokens")).encode("utf-8")

    has_images = any(MEDIA_TYPES[m] == "image" for _, _, m in asset_items)
    has_math = any(m for *_, m in chapter_items)
    a11y = doc.get("accessibility") or {}
    modes = a11y.get("modes") or (["textual", "visual"] if has_images else ["textual"])
    features = a11y.get("features") or (
        ["structuralNavigation", "tableOfContents"]
        + (["alternativeText"] if has_images else [])
        + (["MathML"] if has_math else [])
    )
    meta = [("schema:accessMode", m) for m in modes]
    meta += [("schema:accessModeSufficient", s) for s in (a11y.get("sufficient") or ["textual"])]
    meta += [("schema:accessibilityFeature", f) for f in features]
    meta += [("schema:accessibilityHazard", h) for h in (a11y.get("hazards") or ["none"])]
    meta.append(("schema:accessibilitySummary", a11y.get("summary") or "Reflowable, semantically structured text with a table of contents."))

    manifest_items = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
                      '<item id="css" href="styles/flexova.css" media-type="text/css"/>']
    mathml_prop = ' properties="mathml"'
    manifest_items += [
        f'<item id="{iid}" href="{p}" media-type="application/xhtml+xml"{mathml_prop if math else ""}/>'
        for iid, p, _, math in chapter_items
    ]
    manifest_items += [f'<item id="{iid}" href="{p}" media-type="{m}"/>' for iid, p, m in asset_items]
    opf = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang={quoteattr(lang)} '
        f'prefix={quoteattr("flexova: " + CONSTANTS["namespaceUri"])}>'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f'<dc:identifier id="uid">{escape(doc["identifier"])}</dc:identifier>'
        f'<dc:title>{escape(doc["title"])}</dc:title><dc:language>{escape(lang)}</dc:language>'
        + "".join(f"<dc:creator>{escape(a)}</dc:creator>" for a in doc.get("authors") or [])
        + f'<meta property="dcterms:modified">{escape(doc["modified"])}</meta>'
        f'<meta property="flexova:profile">{CONSTANTS["profileVersion"]}</meta>'
        + "".join(f'<meta property="{p}">{escape(v)}</meta>' for p, v in meta)
        + "</metadata><manifest>" + "".join(manifest_items) + "</manifest><spine>"
        + "".join(f'<itemref idref="{iid}"/>' for iid, *_ in chapter_items)
        + "</spine></package>\n"
    )
    files["package.opf"] = opf.encode("utf-8")

    entries = {f"OEBPS/{p}": data for p, data in files.items()}
    entries["META-INF/container.xml"] = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
        '<rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>'
        "</rootfiles></container>\n"
    ).encode("utf-8")
    manifest = {
        "flexova": CONSTANTS["profileVersion"],
        "level": "L0",
        **({"tokens": doc["tokens"]} if doc.get("tokens") is not None else {}),
        "entries": [
            {"path": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            for name, data in sorted(entries.items())
        ],
    }
    entries[CONSTANTS["manifestPath"]] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

    ordered = [("mimetype", CONSTANTS["containerMimetype"].encode("ascii"), False)]
    ordered += [(name, entries[name], True) for name in sorted(entries)]
    package = write_zip(ordered)
    report = validate(package)
    if not report.valid:
        raise FlexovaError(report)
    return package
