"""Minimal Flex writer using ONLY the Python standard library — the 'integrate from any stack' baseline.
Usage: python3 flex_min.py out.flex"""
import json, sys, uuid, zipfile
from xml.sax.saxutils import escape

XHTML = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"'
CHART = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" role="img"><style>
rect{fill:#0b5fff}text{fill:#1a1a1a;font:14px sans-serif}
@media (prefers-color-scheme:dark){rect{fill:#7aa7ff}text{fill:#e8e6e3}}</style>
<rect x="20" y="120" width="70" height="60"/><rect x="120" y="90" width="70" height="90"/>
<rect x="220" y="60" width="70" height="120"/><rect x="320" y="30" width="70" height="150"/>
<text x="20" y="20">Revenue by quarter</text></svg>"""

def chapter(title, body):
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<html {XHTML}><head><meta charset="utf-8"/><title>{escape(title)}</title>'
            f'<link rel="stylesheet" href="../styles/flex.css"/></head><body>{body}</body></html>')

def build(path, title, sections, tokens):
    files = {
        "META-INF/container.xml": '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        "META-INF/flex.json": json.dumps({"flex": "1.0", "level": "L0", "tokens": tokens}),
        "OEBPS/styles/flex.css": ":root{color-scheme:light dark}body{max-width:68ch;margin:auto;padding:0 1rem;font:1.0625rem/1.6 system-ui,sans-serif}"
            "img{max-width:100%;height:auto}.flex-table{overflow-x:auto}",
        "OEBPS/assets/chart.svg": CHART,
    }
    items, spine, toc = [], [], []
    for i, (sid, heading, html) in enumerate(sections, 1):
        href = f"content/{i:02d}.xhtml"
        files["OEBPS/" + href] = chapter(heading, f'<section id="{sid}"><h1 id="h-{sid}">{escape(heading)}</h1>{html}</section>')
        items.append(f'<item id="c{i}" href="{href}" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="c{i}"/>')
        toc.append(f'<li><a href="{href}#{sid}">{escape(heading)}</a></li>')
    files["OEBPS/nav.xhtml"] = (f'<?xml version="1.0" encoding="UTF-8"?>\n<html {XHTML}><head><title>Contents</title></head><body>'
        f'<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>{"".join(toc)}</ol></nav></body></html>')
    a11y = "".join(f'<meta property="schema:{k}">{v}</meta>' for k, v in [("accessMode", "textual"), ("accessMode", "visual"),
        ("accessModeSufficient", "textual"), ("accessibilityFeature", "alternativeText"), ("accessibilityFeature", "structuralNavigation"),
        ("accessibilityFeature", "tableOfContents"), ("accessibilityHazard", "none"), ("accessibilitySummary", "Reflowable text; all images have text alternatives.")])
    files["OEBPS/package.opf"] = (f'<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" '
        f'unique-identifier="uid" xml:lang="en" prefix="flex: https://flex.example/vocab#"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f'<dc:identifier id="uid">urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, title)}</dc:identifier><dc:title>{escape(title)}</dc:title>'
        f'<dc:language>en</dc:language><meta property="dcterms:modified">2026-10-31T00:00:00Z</meta><meta property="flex:profile">1.0</meta>{a11y}'
        f'</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
        f'<item id="css" href="styles/flex.css" media-type="text/css"/><item id="chart" href="assets/chart.svg" media-type="image/svg+xml"/>'
        f'{"".join(items)}</manifest><spine>{"".join(spine)}</spine></package>')
    with zipfile.ZipFile(path, "w") as z:                       # deterministic: fixed timestamps, fixed order
        z.writestr(zipfile.ZipInfo("mimetype", (1980, 1, 1, 0, 0, 0)), "application/epub+zip", zipfile.ZIP_STORED)
        for name in sorted(files):
            z.writestr(zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0)), files[name], zipfile.ZIP_DEFLATED)

build(sys.argv[1], "Field Service Manual", [
    ("sec-intro", "Before you start", '<p id="p1">Isolate the unit and confirm <strong>zero voltage</strong> before opening the panel.</p>'
        '<aside role="note" data-flex-variant="warning" id="n1"><p>Capacitors may hold charge for 5 minutes.</p></aside>'),
    ("sec-specs", "Specifications", '<figure id="fig-1"><img src="../assets/chart.svg" width="400" height="200" '
        'alt="Bar chart: revenue rising each quarter, Q1 lowest and Q4 highest"/><figcaption>Figure 1. Quarterly revenue</figcaption></figure>'
        '<div class="flex-table" role="region" aria-label="Torque table" tabindex="0"><table><caption>Torque settings</caption>'
        '<thead><tr><th scope="col">Bolt</th><th scope="col">Size</th><th scope="col">Torque (Nm)</th></tr></thead>'
        '<tbody><tr><td>A1</td><td>M8</td><td>25</td></tr><tr><td>B4</td><td>M10</td><td>49</td></tr></tbody></table></div>'),
], tokens={"color": {"fg": {"light": "#1a1a1a", "dark": "#e8e6e3"}, "bg": {"light": "#ffffff", "dark": "#121212"},
                     "accent": {"light": "#0b5fff", "dark": "#7aa7ff"}, "warning-bg": {"light": "#fff4e5", "dark": "#3a2a12"}}})
