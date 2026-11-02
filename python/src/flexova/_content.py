"""Content-profile validation of one XHTML document against spec/profile/profile-1.0.json."""

import re

from ._paths import SCHEME, parent_dir, resolve
from ._spec import EPUB_NS, LIMITS, MATHML_NS, MEDIA_TYPES, PROFILE, XHTML_NS, XHTML_TYPE, XLINK_NS, XML_NS
from ._xml import XML_WS, Element, split_ws

ELEMENTS: dict = PROFILE["elements"]
GLOBAL_ATTRS: dict = PROFILE["globalAttributes"]
ATTR_TYPES: dict = PROFILE["attributeTypes"]
FORBIDDEN_ELEMENTS = set(PROFILE["forbiddenElements"])
FORBIDDEN_ATTRS = [re.compile(p, re.I) for p in PROFILE["forbiddenAttributePatterns"]]
MATHML_ELEMENTS = set(PROFILE["mathml"]["elements"])
MATHML_ATTRS = set(PROFILE["mathml"]["attributes"])
MATHML_ROOT = PROFILE["mathml"]["root"]
MATHML_ROOT_CATEGORY = PROFILE["mathml"]["rootCategory"]
HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
_PREFIXES = {XML_NS: "xml:", EPUB_NS: "epub:", XLINK_NS: "xlink:"}


def canonical_attr(ns: str, local: str) -> str:
    if not ns:
        return local
    prefix = _PREFIXES.get(ns)
    return prefix + local if prefix else "{" + ns + "}" + local


def classify(el: Element):
    """('forbidden'|'unknown'|'xhtml'|'mathml', element definition or None)."""
    if el.local in FORBIDDEN_ELEMENTS:
        return "forbidden", None
    if el.ns == XHTML_NS and el.local in ELEMENTS:
        return "xhtml", ELEMENTS[el.local]
    if el.ns == MATHML_NS and el.local in MATHML_ELEMENTS:
        return "mathml", None
    return "unknown", None


def category(el: Element):
    kind, d = classify(el)
    if kind == "xhtml":
        return d["category"]
    if kind == "mathml":
        return MATHML_ROOT_CATEGORY if el.local == MATHML_ROOT else "mathml"
    return None  # forbidden/unknown children are reported on their own and ignored by content models


class ContentValidator:
    def __init__(self, path: str, pkg, c):
        self.path = path
        self.dir = parent_dir(path)
        self.pkg = pkg
        self.c = c
        self.ids: set = set()
        self.headings: list = []
        self.too_deep = False
        self.has_toc = False
        self.same_doc_fragments: list = []
        self.cross_doc_links: list = []  # (target path, fragment)

    def run(self, root: Element) -> None:
        self.visit(root, 1, frozenset())
        prev = None
        for level in self.headings:
            if prev is not None and level > prev + 1:
                self.c.add("PRF_HEADING_SKIP", self.path, f"h{prev} followed by h{level}")
                break
            prev = level

    # --- elements -------------------------------------------------------------------------------
    def visit(self, el: Element, depth: int, excluded: frozenset) -> None:
        if depth > LIMITS["maxNestingDepth"]:
            if not self.too_deep:
                self.c.add("PRF_TOO_DEEP", self.path)
                self.too_deep = True
            return
        kind, d = classify(el)
        if kind == "forbidden":
            self.c.add("PRF_FORBIDDEN_ELEMENT", self.path, f"<{el.local}>")
            return
        if kind == "unknown":
            self.c.add("PRF_UNKNOWN_ELEMENT", self.path, f"<{el.local}>")
            return
        if kind == "xhtml" and el.local in excluded:
            self.c.add("PRF_CONTENT_MODEL", self.path, f"<{el.local}> may not be nested in another <{el.local}>")
        self.check_attributes(el, kind, d)
        if kind == "xhtml":
            if el.local in HEADINGS:
                self.headings.append(HEADINGS[el.local])
            if el.local == "table" and not any(
                e.ns == XHTML_NS and e.local == "th" for e in el.iter()
            ):
                self.c.add("PRF_TABLE_NO_HEADERS", self.path, el.attr("id") or "")
            if el.local == "nav" and "toc" in split_ws(el.attr("type", EPUB_NS) or ""):
                self.has_toc = True
            self.check_content(el, d["content"])
            excluded = excluded | frozenset(d.get("excludes", []))
        else:
            for kid in el.elements():
                if classify(kid)[0] == "xhtml":
                    self.c.add("PRF_CONTENT_MODEL", self.path, f"<{kid.local}> inside MathML")
        for kid in el.elements():
            self.visit(kid, depth + 1, excluded)

    def check_content(self, el: Element, model: dict) -> None:
        kids = [k for k in el.elements() if category(k) is not None]
        has_text = any(t.strip(XML_WS) for t in el.texts())
        typ = model["type"]

        def bad(detail: str) -> None:
            self.c.add("PRF_CONTENT_MODEL", self.path, f"<{el.local}>: {detail}")

        if typ == "empty":
            if kids or has_text:
                bad("must be empty")
        elif typ == "text":
            if kids:
                bad("may contain text only")
        elif typ == "inline":
            for k in kids:
                if category(k) != "inline":
                    bad(f"<{k.local}> is not inline content")
        elif typ == "blocks":
            if has_text:
                bad("text must be wrapped in a block element")
            for k in kids:
                if category(k) != "block":
                    bad(f"<{k.local}> is not block content")
        elif typ == "blocks-or-inline":
            if any(category(k) == "block" for k in kids):
                if has_text:
                    bad("mixes text with block content")
                for k in kids:
                    if category(k) != "block":
                        bad(f"<{k.local}> mixes inline with block content")
            else:
                for k in kids:
                    if category(k) != "inline":
                        bad(f"<{k.local}> is not inline content")
        elif typ == "children":
            allowed = model["allowed"]
            if has_text:
                bad("text is not allowed here")
            counts: dict = {}
            for k in kids:
                if k.local in allowed:
                    counts[k.local] = counts.get(k.local, 0) + 1
                else:
                    bad(f"<{k.local}> is not allowed here")
            for name, (lo, hi) in allowed.items():
                n = counts.get(name, 0)
                if n < lo or (hi is not None and n > hi):
                    bad(f"<{name}> count {n} is outside [{lo}, {hi}]")
            if "requireOneOf" in model and not any(counts.get(n) for n in model["requireOneOf"]):
                bad("missing required content")
        elif typ == "sequence":
            if has_text:
                bad("text is not allowed here")
            i = 0
            for item in model["items"]:
                count = 0
                while i < len(kids) and self.matches(item, kids[i]) and (item["max"] is None or count < item["max"]):
                    count += 1
                    i += 1
                if count < item["min"]:
                    bad("required child is missing or out of order")
            if i < len(kids):
                bad(f"<{kids[i].local}> is not allowed here")

    @staticmethod
    def matches(item: dict, kid: Element) -> bool:
        if "element" in item:
            return kid.local == item["element"]
        if "anyOf" in item:
            return kid.local in item["anyOf"]
        return category(kid) == item["category"]

    # --- attributes -----------------------------------------------------------------------------
    def check_attributes(self, el: Element, kind: str, d) -> None:
        present: dict = {}
        for ns, local, value in el.attrs:
            name = canonical_attr(ns, local)
            if any(p.search(name) for p in FORBIDDEN_ATTRS):
                self.c.add("PRF_FORBIDDEN_ATTRIBUTE", self.path, f"{name} on <{el.local}>")
                continue
            if kind == "mathml":
                spec = "text" if (not ns and local in MATHML_ATTRS) else None
            else:
                spec = d.get("attributes", {}).get(name) or GLOBAL_ATTRS.get(name)
            if spec is None:
                self.c.add("PRF_ATTRIBUTE_NOT_ALLOWED", self.path, f"{name} on <{el.local}>")
                continue
            present[name] = value
            self.check_value(el, name, value, spec, d)
        if kind == "xhtml":
            for req in d.get("required", []):
                if req not in present:
                    code = d.get("missingCodes", {}).get(req, "PRF_MISSING_ATTRIBUTE")
                    self.c.add(code, self.path, f"{req} on <{el.local}>")
            if el.local == "html" and "lang" in present and "xml:lang" in present:
                if present["lang"].lower() != present["xml:lang"].lower():
                    self.c.add("PRF_INVALID_VALUE", self.path, "lang and xml:lang differ")
        if "id" in present:
            if present["id"] in self.ids:
                self.c.add("PRF_DUPLICATE_ID", self.path, present["id"])
            self.ids.add(present["id"])

    def check_value(self, el: Element, name: str, value: str, spec, d) -> None:
        if isinstance(spec, dict):
            if value not in spec["enum"]:
                self.c.add("PRF_INVALID_VALUE", self.path, f"{name}={value!r} on <{el.local}>")
            return
        t = ATTR_TYPES[spec]
        if "pattern" in t and not re.fullmatch(t["pattern"], value):
            self.c.add("PRF_INVALID_VALUE", self.path, f"{name}={value!r} on <{el.local}>")
        kind = t.get("kind")
        if kind == "boolean" and value not in ("", name):
            self.c.add("PRF_INVALID_VALUE", self.path, f"{name}={value!r} on <{el.local}>")
        elif kind == "local-uri":
            self.check_local_uri(el, name, value, d.get("targets", {}).get(name, []) if d else [])
        elif kind == "link-uri":
            self.check_link(value, t["schemes"])

    def check_local_uri(self, el: Element, name: str, value: str, target_kinds: list) -> None:
        where = f"{name}={value!r} on <{el.local}>"
        if SCHEME.match(value) or value.startswith("//"):
            remote = value.startswith("//") or value.split(":", 1)[0].lower() in ("http", "https")
            self.c.add("PRF_REMOTE_RESOURCE" if remote else "PRF_INVALID_VALUE", self.path, where)
            return
        target = resolve(self.dir, value)
        if target is None:
            self.c.add("PRF_INVALID_VALUE", self.path, where)
            return
        item = self.pkg.by_path.get(target)
        if item is None:
            self.c.add("PRF_BROKEN_REFERENCE", self.path, where)
            return
        if target_kinds and MEDIA_TYPES.get(item.media_type) not in target_kinds:
            self.c.add("PRF_INVALID_VALUE", self.path, f"{where} has the wrong media type")

    def check_link(self, value: str, schemes: list) -> None:
        where = f"href={value!r}"
        if SCHEME.match(value):
            if value.split(":", 1)[0].lower() not in schemes:
                self.c.add("PRF_INVALID_VALUE", self.path, where)
            return
        if value.startswith("//") or any(ch in value for ch in "?%\\" + XML_WS):
            self.c.add("PRF_INVALID_VALUE", self.path, where)
            return
        path_part, sep, fragment = value.partition("#")
        if not path_part:
            if fragment:
                self.same_doc_fragments.append(fragment)
            else:
                self.c.add("PRF_BROKEN_LINK", self.path, where)
            return
        target = resolve(self.dir, path_part)
        if target is None:
            self.c.add("PRF_INVALID_VALUE", self.path, where)
            return
        item = self.pkg.by_path.get(target)
        if item is None or item.media_type != XHTML_TYPE or (sep and not fragment):
            self.c.add("PRF_BROKEN_LINK", self.path, where)
            return
        if fragment:
            self.cross_doc_links.append((target, fragment))
