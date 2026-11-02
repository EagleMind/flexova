"""Strict XML loading shared by every check: UTF-8 only, no DTDs, namespace-aware, comments and PIs dropped."""

import re
from xml.parsers import expat

XML_WS = " \t\r\n"

_XMLDECL = re.compile(r"<\?xml[^>]*?encoding[ \t\r\n]*=[ \t\r\n]*[\"']([^\"']*)[\"']")
_ENTITY = re.compile(r"<!ENTITY", re.I)
_DOCTYPE = re.compile(r"<!DOCTYPE", re.I)
_DOCTYPE_HTML = re.compile(r"<!DOCTYPE[ \t\r\n]+html[ \t\r\n]*>", re.I)


def xml_trim(s: str) -> str:
    return s.strip(XML_WS)


def split_ws(s: str) -> list:
    return [t for t in re.split(r"[ \t\r\n]+", s) if t]


class Element:
    __slots__ = ("ns", "local", "attrs", "children")

    def __init__(self, ns: str, local: str, attrs: list):
        self.ns = ns
        self.local = local
        self.attrs = attrs  # list of (ns, local, value)
        self.children = []  # Element or str

    def attr(self, local: str, ns: str = ""):
        for a_ns, a_local, value in self.attrs:
            if a_ns == ns and a_local == local:
                return value
        return None

    def elements(self) -> list:
        return [c for c in self.children if isinstance(c, Element)]

    def texts(self) -> list:
        return [c for c in self.children if isinstance(c, str)]

    def iter(self):
        """Pre-order traversal of this element and all descendant elements (iterative)."""
        stack = [self]
        while stack:
            el = stack.pop()
            yield el
            stack.extend(reversed(el.elements()))

    def text(self) -> str:
        out = []
        stack = [self]
        while stack:
            node = stack.pop()
            if isinstance(node, str):
                out.append(node)
            else:
                stack.extend(reversed(node.children))
        return "".join(out)


def _split(name: str):
    ns, sep, local = name.rpartition(" ")
    return (ns, local) if sep else ("", name)


def decode_utf8(data: bytes):
    """Strict UTF-8 decode with an optional BOM removed; None if the bytes are not UTF-8."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return text[1:] if text.startswith("﻿") else text


def parse_xml(data: bytes, allow_html_doctype: bool):
    """Return (root Element, None) or (None, error code)."""
    text = decode_utf8(data)
    if text is None:
        return None, "XML_ENCODING"
    decl = _XMLDECL.match(text)
    if decl and decl.group(1).lower() != "utf-8":
        return None, "XML_ENCODING"
    if _ENTITY.search(text):
        return None, "XML_DTD_FORBIDDEN"
    for m in _DOCTYPE.finditer(text):
        if not (allow_html_doctype and _DOCTYPE_HTML.match(text, m.start())):
            return None, "XML_DTD_FORBIDDEN"

    parser = expat.ParserCreate(namespace_separator=" ")
    parser.buffer_text = True
    stack: list = []
    holder: list = []

    def start(name, attrs):
        ns, local = _split(name)
        el = Element(ns, local, [(*_split(k), v) for k, v in attrs.items()])
        if stack:
            stack[-1].children.append(el)
        else:
            holder.append(el)
        stack.append(el)

    def end(_name):
        stack.pop()

    def chars(data):
        if stack:
            kids = stack[-1].children
            if kids and isinstance(kids[-1], str):
                kids[-1] += data
            else:
                kids.append(data)

    parser.StartElementHandler = start
    parser.EndElementHandler = end
    parser.CharacterDataHandler = chars
    try:
        parser.Parse(text, True)
    except expat.ExpatError:
        return None, "XML_MALFORMED"
    if not holder:
        return None, "XML_MALFORMED"
    return holder[0], None
