import { parseXml, type XmlElement } from "@flexova/core";
import { describe, expect, it } from "vitest";
import { rebuild, rewriteLink, type RenderContext, type Sink, type Source } from "./render.js";

// Source over @flexova/core's XML tree, and a sink that serializes to a compact string for assertions.
type X = XmlElement | string;
const xml: Source<X> = {
  type: (n) => (typeof n === "string" ? 3 : 1),
  ns: (n) => (n as XmlElement).ns,
  local: (n) => (n as XmlElement).local,
  attrs: (n) => (n as XmlElement).attrs.map((a) => [a.ns, a.local, a.value]),
  kids: (n) => (typeof n === "string" ? [] : n.children),
  text: (n) => n as string,
};
interface Node {
  name: string;
  math: boolean;
  attrs: [string, string][];
  kids: (Node | string)[];
}
const sink: Sink<Node | string> = {
  element: (name, math) => ({ name, math, attrs: [], kids: [] }),
  text: (value) => value,
  attr: (n, k, v) => (n as Node).attrs.push([k, v]),
  append: (p, c) => (p as Node).kids.push(c),
};
const serialize = (n: Node | string): string =>
  typeof n === "string"
    ? n
    : `<${n.math ? "m:" : ""}${n.name}${n.attrs.map(([k, v]) => ` ${k}="${v}"`).join("")}>${n.kids.map(serialize).join("")}</${n.name}>`;

const ctx: RenderContext = {
  doc: "OEBPS/content/01.xhtml",
  anchors: new Map([
    ["OEBPS/content/01.xhtml", "d1"],
    ["OEBPS/content/02.xhtml", "d2"],
  ]),
  asset: (path, kinds) =>
    path === "OEBPS/assets/icon.png" && kinds.includes("image") ? "blob:icon" : null,
  external: { target: "_blank", rel: "noopener noreferrer" },
};

function render(body: string): string {
  const doc = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><body>${body}</body></html>`;
  const parsed = parseXml(new TextEncoder().encode(doc), true);
  if (parsed.root === null) throw new Error(parsed.error);
  const bodyEl = parsed.root.elements().find((e) => e.local === "body") as XmlElement;
  const out: Node = { name: "root", math: false, attrs: [], kids: [] };
  rebuild(xml, sink, bodyEl, out, ctx);
  return out.kids.map(serialize).join("");
}

describe("rebuild()", () => {
  it("namespaces ids per document and rewrites internal links", () => {
    expect(
      render(
        '<h1 id="t">T</h1><p><a href="#t">same</a> <a href="02.xhtml#x">cross</a> <a href="02.xhtml">doc</a></p>',
      ),
    ).toBe(
      '<h1 id="d1-t">T</h1><p><a href="#d1-t">same</a> <a href="#d2-x">cross</a> <a href="#d2">doc</a></p>',
    );
  });

  it("keeps safe external links and marks them, drops dangerous or unknown targets", () => {
    expect(
      render('<p><a href="https://example.org/">web</a><a href="mailto:a@b.c">mail</a></p>'),
    ).toBe(
      '<p><a href="https://example.org/" target="_blank" rel="noopener noreferrer">web</a><a href="mailto:a@b.c" target="_blank" rel="noopener noreferrer">mail</a></p>',
    );
    expect(
      render(
        '<p><a href="javascript:alert(1)">x</a><a href="99.xhtml#y">y</a><a href="#">z</a></p>',
      ),
    ).toBe("<p><a>x</a><a>y</a><a>z</a></p>");
  });

  it("drops forbidden elements with their subtree and unwraps unknown ones", () => {
    expect(
      render(
        '<p>a</p><script>alert(1)</script><iframe src="https://e.x/"></iframe><form><input/></form>' +
          '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg><div><p>kept</p></div>',
      ),
    ).toBe("<p>a</p><p>kept</p>");
  });

  it("drops forbidden and unknown attributes, maps xml:lang, drops epub:type", () => {
    expect(render('<p style="color:red" onclick="x()" class="c" dir="rtl">x</p>')).toBe(
      '<p dir="rtl">x</p>',
    );
    expect(
      render(
        '<p xml:lang="fr">x</p><section epub:type="chapter" role="doc-chapter"><p>y</p></section>',
      ),
    ).toBe('<p lang="fr">x</p><section role="doc-chapter"><p>y</p></section>');
    expect(render('<p dir="sideways" id="1bad">x</p>')).toBe("<p>x</p>");
  });

  it("embeds only package resources and drops images that would load remotely", () => {
    expect(render('<p><img src="../assets/icon.png" alt="i"/></p>')).toBe(
      '<p><img src="blob:icon" alt="i"></img></p>',
    );
    expect(
      render(
        '<p><img src="https://tracker.example/p.gif" alt=""/><img src="data:image/png;base64,AAAA" alt=""/><img alt="no src"/></p>',
      ),
    ).toBe("<p></p>");
    expect(render('<p><img src="../styles/flexova.css" alt="not an image"/></p>')).toBe("<p></p>");
  });

  it("wraps tables in a focusable, labelled scroll region", () => {
    expect(
      render(
        '<table id="t"><caption>Torque  <em>settings</em></caption><tbody><tr><th>A</th></tr></tbody></table>',
      ),
    ).toBe(
      '<div class="fx-scroll" role="region" tabindex="0" aria-label="Torque settings"><table id="d1-t"><caption>Torque  <em>settings</em></caption><tbody><tr><th>A</th></tr></tbody></table></div>',
    );
  });

  it("keeps MathML as MathML", () => {
    expect(
      render(
        '<p><math xmlns="http://www.w3.org/1998/Math/MathML" display="block" href="https://e.x/"><mi>x</mi></math></p>',
      ),
    ).toBe('<p><m:math display="block"><m:mi>x</mi></math></p>');
  });

  it("stops at the nesting limit instead of recursing without bound", () => {
    const deep = "<span>".repeat(5000) + "x" + "</span>".repeat(5000);
    const out = render(`<p>${deep}</p>`);
    expect(out.length).toBeLessThan(1000);
  });
});

describe("rewriteLink()", () => {
  it("rejects protocol-relative, query and escaping links", () => {
    for (const bad of ["//evil.example/", "02.xhtml?x=1", "../../../etc/passwd", "ftp://x/"]) {
      expect(rewriteLink(bad, ctx), bad).toBeNull();
    }
  });
});
