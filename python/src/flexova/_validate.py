"""validate(): the four validation phases of spec/flexova-1.0.md section 8 (zip, package, manifest, resources)."""

import hashlib
import json
import re

from ._content import ContentValidator
from ._paths import parent_dir, resolve
from ._report import Collector, Report
from ._spec import (
    CONSTANTS,
    CONTAINER_NS,
    DC_NS,
    MEDIA_TYPES,
    OPF_NS,
    PROFILE,
    SVG_NS,
    XHTML_NS,
    XHTML_TYPE,
)
from ._tokens import check_tokens, is_integer
from ._xml import decode_utf8, parse_xml, split_ws, xml_trim
from ._zip import read_zip

MANIFEST_PATH = CONSTANTS["manifestPath"]
SIGNATURE_PATH = "META-INF/flexova.sig.jws"
UNLISTED = {"mimetype", MANIFEST_PATH, SIGNATURE_PATH}
LANG = re.compile(PROFILE["attributeTypes"]["lang"]["pattern"])
MODIFIED = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
VERSION = re.compile(r"[0-9]+\.[0-9]+")
SHA256 = re.compile(r"[0-9a-f]{64}")
A11Y_PROPERTIES = (
    "schema:accessMode",
    "schema:accessModeSufficient",
    "schema:accessibilityFeature",
    "schema:accessibilityHazard",
    "schema:accessibilitySummary",
)
_WS = "[ \t\r\n\f]"
CSS_UNSAFE = [
    re.compile(r"@import", re.I),
    re.compile(rf"url\({_WS}*[\"']?{_WS}*([a-z][a-z0-9+.-]*:|//)", re.I),
    re.compile(rf"expression{_WS}*\(", re.I),
    re.compile(rf"behavior{_WS}*:", re.I),
    re.compile(r"-moz-binding", re.I),
    re.compile(r"javascript:", re.I),
]
SVG_UNSAFE_ELEMENTS = {"script", "foreignobject", "iframe", "handler", "listener"}
MAGIC = {
    "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/jpeg": lambda b: b[:3] == b"\xff\xd8\xff",
    "image/gif": lambda b: b[:6] in (b"GIF87a", b"GIF89a"),
    "image/webp": lambda b: len(b) >= 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP",
}


class Item:
    __slots__ = ("id", "path", "media_type", "properties", "supported", "exists")

    def __init__(self, item_id, path, media_type, properties):
        self.id, self.path, self.media_type, self.properties = item_id, path, media_type, properties
        self.supported = media_type in MEDIA_TYPES
        self.exists = True


class Package:
    def __init__(self, opf_path, items):
        self.opf_path = opf_path
        self.items = items  # document order
        self.by_path = {it.path: it for it in items}
        self.nav_path = None
        self.spine = []


def _children(el, ns, local):
    return [] if el is None else [e for e in el.elements() if e.ns == ns and e.local == local]


def _first(el, ns, local):
    found = _children(el, ns, local)
    return found[0] if found else None


def _parse_prefix(value: str) -> dict:
    tokens = split_ws(value)
    mapping, i = {}, 0
    while i < len(tokens):
        if tokens[i].endswith(":") and i + 1 < len(tokens):
            mapping[tokens[i][:-1]] = tokens[i + 1]
            i += 2
        else:
            i += 1
    return mapping


# --- phase 2: package ---------------------------------------------------------------------------
def check_package(entries: dict, c: Collector):
    container_path = "META-INF/container.xml"
    if container_path not in entries:
        c.add("OCF_CONTAINER_MISSING", container_path)
        return None
    root, err = parse_xml(entries[container_path], allow_html_doctype=False)
    if err:
        c.add(err, container_path)
        return None
    opf_path = None
    if root.ns == CONTAINER_NS and root.local == "container":
        rootfile = next((e for e in root.iter() if e.ns == CONTAINER_NS and e.local == "rootfile"), None)
        if rootfile is not None and rootfile.attr("media-type") == "application/oebps-package+xml":
            opf_path = rootfile.attr("full-path")
    if not opf_path or opf_path not in entries:
        c.add("OCF_ROOTFILE_MISSING", container_path)
        return None
    root, err = parse_xml(entries[opf_path], allow_html_doctype=False)
    if err:
        c.add(err, opf_path)
        return None
    if not (root.ns == OPF_NS and root.local == "package" and root.attr("version") == "3.0"):
        c.add("OPF_INVALID", opf_path, 'root must be <package version="3.0">')
        return None

    # metadata
    metadata = _first(root, OPF_NS, "metadata")
    metas: dict = {}
    for m in _children(metadata, OPF_NS, "meta"):
        prop = m.attr("property")
        if prop is not None and xml_trim(m.text()):
            metas.setdefault(prop, []).append(xml_trim(m.text()))
    uid = root.attr("unique-identifier")
    missing = []
    if not any(e.attr("id") == uid and xml_trim(e.text()) for e in _children(metadata, DC_NS, "identifier")):
        missing.append("dc:identifier")
    if not any(xml_trim(e.text()) for e in _children(metadata, DC_NS, "title")):
        missing.append("dc:title")
    langs = [xml_trim(e.text()) for e in _children(metadata, DC_NS, "language") if xml_trim(e.text())]
    if not langs:
        missing.append("dc:language")
    modified = metas.get("dcterms:modified", [])
    if not modified:
        missing.append("dcterms:modified")
    if missing:
        c.add("OPF_MISSING_METADATA", opf_path, ", ".join(missing))
    invalid = []
    if langs and not LANG.fullmatch(langs[0]):
        invalid.append("dc:language")
    if modified and not MODIFIED.fullmatch(modified[0]):
        invalid.append("dcterms:modified")
    if invalid:
        c.add("OPF_INVALID_METADATA", opf_path, ", ".join(invalid))
    profile = metas.get("flexova:profile", [])
    if _parse_prefix(root.attr("prefix") or "").get("flexova") != CONSTANTS["namespaceUri"] or not profile:
        c.add("OPF_PROFILE_MISSING", opf_path)
    elif not re.fullmatch(r"1\.[0-9]+", profile[0]):
        c.add("OPF_PROFILE_UNSUPPORTED", opf_path, profile[0])
    if not all(p in metas for p in A11Y_PROPERTIES):
        c.add("OPF_A11Y_METADATA_MISSING", opf_path)

    # manifest items
    manifest = _first(root, OPF_NS, "manifest")
    opf_dir = parent_dir(opf_path)
    items, ids, paths = [], set(), set()
    problem = None if manifest is not None else "no <manifest>"
    for e in _children(manifest, OPF_NS, "item"):
        item_id, href, media_type = e.attr("id"), e.attr("href"), e.attr("media-type")
        path = resolve(opf_dir, href) if href else None
        if not item_id or not media_type or path is None:
            problem = "an <item> lacks id, media-type or a valid local href"
        elif item_id in ids or path in paths:
            problem = f"duplicate item {item_id} / {path}"
        if problem:
            break
        ids.add(item_id)
        paths.add(path)
        items.append(Item(item_id, path, media_type, set(split_ws(e.attr("properties") or ""))))
    if problem:
        c.add("OPF_INVALID", opf_path, problem)
        return None
    pkg = Package(opf_path, items)
    for it in sorted(items, key=lambda i: i.path):
        if not it.supported:
            c.add("OPF_UNSUPPORTED_MEDIA_TYPE", it.path, it.media_type)
        if it.path not in entries:
            c.add("OPF_MISSING_RESOURCE", it.path)
            it.exists = False
    for name in sorted(entries):
        if name != "mimetype" and not name.startswith("META-INF/") and name != opf_path and name not in pkg.by_path:
            c.add("OPF_UNDECLARED_RESOURCE", name)
    nav = next((it for it in items if "nav" in it.properties), None)
    if nav is None or nav.media_type != XHTML_TYPE:
        c.add("OPF_NAV_MISSING", opf_path)
    else:
        pkg.nav_path = nav.path

    spine = _first(root, OPF_NS, "spine")
    refs = _children(spine, OPF_NS, "itemref")
    if not refs:
        c.add("OPF_SPINE_INVALID", opf_path, "empty spine")
    by_id = {it.id: it for it in items}
    for ref in refs:
        it = by_id.get(ref.attr("idref") or "")
        if it is None or it.media_type != XHTML_TYPE:
            c.add("OPF_SPINE_INVALID", opf_path, f"itemref {ref.attr('idref')!r}")
        else:
            pkg.spine.append(it.path)
    return pkg


# --- phase 3: manifest --------------------------------------------------------------------------
def _reject_constant(name):
    raise ValueError(f"{name} is not valid JSON")


def check_manifest(entries: dict, c: Collector) -> None:
    raw = entries.get(MANIFEST_PATH)
    if raw is None:
        c.add("MAN_MISSING", MANIFEST_PATH)
        return
    try:
        doc = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError):
        c.add("MAN_INVALID", MANIFEST_PATH, "not valid UTF-8 JSON")
        return
    if not isinstance(doc, dict):
        c.add("MAN_INVALID", MANIFEST_PATH, "must be a JSON object")
        return
    version = doc.get("flexova")
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        c.add("MAN_INVALID", MANIFEST_PATH, "flexova must be a MAJOR.MINOR string")
        return
    if version.split(".")[0] != "1":
        c.add("MAN_UNSUPPORTED_VERSION", MANIFEST_PATH, version)
        return
    level = doc.get("level")
    if not isinstance(level, str) or level not in ("L0", "L1", "L2"):
        c.add("MAN_INVALID", MANIFEST_PATH, "level must be L0, L1 or L2")
        return
    if level != "L0":
        c.add("MAN_UNSUPPORTED_LEVEL", MANIFEST_PATH, level)
        return
    if "tokens" in doc:
        check_tokens(doc["tokens"], c, MANIFEST_PATH)

    listed = doc.get("entries")
    if not isinstance(listed, list):
        c.add("MAN_INVALID", MANIFEST_PATH, "entries must be an array")
        return
    seen: dict = {}
    for e in listed:
        ok = (
            isinstance(e, dict)
            and isinstance(e.get("path"), str)
            and e["path"] != ""
            and e["path"] not in UNLISTED
            and e["path"] not in seen
            and is_integer(e.get("size"))
            and e["size"] >= 0
            and isinstance(e.get("sha256"), str)
            and SHA256.fullmatch(e["sha256"]) is not None
        )
        if not ok:
            c.add("MAN_INVALID", MANIFEST_PATH, "malformed or duplicate entry")
            return
        seen[e["path"]] = e
    for path in sorted(seen):
        data = entries.get(path)
        if data is None or len(data) != seen[path]["size"] or hashlib.sha256(data).hexdigest() != seen[path]["sha256"]:
            c.add("MAN_HASH_MISMATCH", path)
    omitted = sorted(n for n in entries if n not in UNLISTED and n not in seen)
    if omitted:
        c.add("MAN_ENTRIES_INCOMPLETE", MANIFEST_PATH, ", ".join(omitted[:5]))


# --- phase 4: resources -------------------------------------------------------------------------
def css_unsafe(text: str) -> bool:
    return any(p.search(text) for p in CSS_UNSAFE)


def check_svg(path: str, data: bytes, c: Collector) -> None:
    root, err = parse_xml(data, allow_html_doctype=False)
    if err:
        c.add(err, path)
        return
    if not (root.ns == SVG_NS and root.local == "svg"):
        c.add("XML_WRONG_NAMESPACE", path)
        return
    for el in root.iter():
        unsafe = el.local.lower() in SVG_UNSAFE_ELEMENTS or (el.local == "style" and css_unsafe(el.text()))
        for _, local, value in el.attrs:
            name = local.lower()
            if name.startswith("on") or (name == "href" and not value.startswith("#")) or (name == "style" and css_unsafe(value)):
                unsafe = True
        if unsafe:
            c.add("ASSET_SVG_UNSAFE", path)
            return


def check_resources(entries: dict, pkg: Package, c: Collector) -> None:
    docs: dict = {}  # path -> ContentValidator, for documents that parsed as XHTML
    for it in sorted(pkg.items, key=lambda i: i.path):
        if not it.supported or not it.exists:
            continue
        data = entries[it.path]
        kind = MEDIA_TYPES[it.media_type]
        if kind == "content":
            root, err = parse_xml(data, allow_html_doctype=True)
            if err:
                c.add(err, it.path)
                continue
            if not (root.ns == XHTML_NS and root.local == "html"):
                c.add("XML_WRONG_NAMESPACE", it.path)
                continue
            v = ContentValidator(it.path, pkg, c)
            v.run(root)
            docs[it.path] = v
        elif kind == "style":
            text = decode_utf8(data)
            if text is None or css_unsafe(text):
                c.add("CSS_UNSAFE", it.path)
        elif it.media_type == "image/svg+xml":
            check_svg(it.path, data, c)
        elif it.media_type in MAGIC and not MAGIC[it.media_type](data):
            c.add("ASSET_TYPE_MISMATCH", it.path, it.media_type)

    if pkg.nav_path in docs and not docs[pkg.nav_path].has_toc:
        c.add("OPF_NAV_INVALID", pkg.nav_path)
    for path, v in docs.items():
        for fragment in v.same_doc_fragments:
            if fragment not in v.ids:
                c.add("PRF_BROKEN_LINK", path, "#" + fragment)
        for target, fragment in v.cross_doc_links:
            if target in docs and fragment not in docs[target].ids:
                c.add("PRF_BROKEN_LINK", path, f"{target}#{fragment}")


def validate(data: bytes) -> Report:
    """Validate a .flexova package. Never raises for malformed input; problems are reported as issues."""
    c = Collector()
    entries = read_zip(bytes(data), c)
    if entries is None:
        return c.report()
    pkg = check_package(entries, c)
    if pkg is None or c.fatal():
        return c.report()
    check_manifest(entries, c)
    if c.fatal():
        return c.report()
    check_resources(entries, pkg, c)
    return c.report()

