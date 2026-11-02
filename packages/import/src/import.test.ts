// Importers: every output must pass write(), which refuses anything the validator rejects.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate, write } from "@flexova/core";
import { describe, expect, it } from "vitest";
import {
  fromMarkdown,
  fromPandoc,
  frontMatter,
  type ImportResult,
  type PandocDocument,
} from "./index.js";

const root = new URL("../../../", import.meta.url);
const sample = (p: string) => new URL(`samples/${p}`, root);
const build = (r: ImportResult) =>
  write({
    ...r,
    identifier: "urn:uuid:00000000-0000-4000-8000-000000000001",
    modified: "2026-11-02T00:00:00Z",
  });
const body = (md: string, i = 0) => fromMarkdown(md, { language: "en" }).chapters[i]?.body ?? "";
const PNG = readFileSync(sample("markdown-manual/images/panel.png"));

function hasPandoc(): boolean {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("fromMarkdown", () => {
  it("converts the sample manual into a valid package with no warnings", async () => {
    const dir = sample("markdown-manual/");
    const config = JSON.parse(readFileSync(new URL("flexova.config.json", dir), "utf8"));
    const sources = config.chapters.map((path: string) => ({
      path,
      text: readFileSync(new URL(path, dir), "utf8"),
    }));
    const result = fromMarkdown(sources, {
      title: config.title,
      language: config.language,
      readFile: (p) => readFileSync(new URL(p, dir)),
    });
    expect(result.warnings).toEqual([]);
    expect(result.chapters.map((c) => c.title)).toEqual([
      "Getting started",
      "Operation",
      "Maintenance",
    ]);
    expect(result.assets.map((a) => [a.path, a.mediaType])).toEqual([
      ["assets/panel.png", "image/png"],
      ["assets/flow.svg", "image/svg+xml"],
    ]);
    const first = result.chapters[0]?.body ?? "";
    expect(first).toContain('<a href="02.xhtml">daily operation</a>');
    expect(first).toContain('<a href="03.xhtml#service-intervals">maintenance</a>');
    expect(first).toContain('<a href="02.xhtml#troubleshooting">troubleshooting</a>');
    expect((await validate(await build(result))).codes).toEqual([]);
  });

  it("is deterministic", async () => {
    const md = "# A\n\nText[^1].\n\n[^1]: Note.\n";
    expect(await build(fromMarkdown(md, { language: "en" }))).toEqual(
      await build(fromMarkdown(md, { language: "en" })),
    );
  });

  it("splits chapters at level-1 headings and keeps a preamble", () => {
    const r = fromMarkdown("Intro text.\n\n# One\n\nA.\n\n# Two\n\nB.\n", {
      title: "Doc",
      language: "en",
    });
    expect(r.chapters.map((c) => c.title)).toEqual(["Doc", "One", "Two"]);
    expect(r.chapters[0]?.body).toContain('<h1 id="doc">Doc</h1><p>Intro text.</p>');
  });

  it("maps GitHub alerts to labelled callouts", () => {
    expect(body("# T\n\n> [!WARNING]\n> Hot surface.\n")).toContain(
      '<aside role="note" data-flexova-variant="warning"><p><strong>Warning</strong></p><p>Hot surface.</p></aside>',
    );
    expect(body("# T\n\n> Just a quote.\n")).toContain(
      "<blockquote><p>Just a quote.</p></blockquote>",
    );
    const fr = fromMarkdown("# T\n\n> [!TIP]\n> Astuce.\n", {
      language: "fr",
      labels: { tip: "Astuce" },
    });
    expect(fr.chapters[0]?.body).toContain("<strong>Astuce</strong>");
  });

  it("renders footnotes as endnotes with links both ways", () => {
    const html = body("# T\n\nA[^a] and B[^b], again A[^a].\n\n[^a]: First.\n[^b]: Second.\n");
    expect(html).toContain('<sup><a href="#fn-1" id="fnref-1">1</a></sup>');
    expect(html).toContain('<sup><a href="#fn-1">1</a></sup>');
    expect(html).toContain('<li id="fn-1"><p>First. <a href="#fnref-1">↩</a></p></li>');
    expect(html).toContain(
      '<section role="doc-endnotes" epub:type="endnotes"><h2 id="notes-1">Notes</h2>',
    );
  });

  it("gives headings ASCII ids and resolves GitHub-style anchors", () => {
    const html = body(
      "# Überblick\n\n## 2. Schritte\n\n## Schritte\n\nSee [steps](#2-schritte) and [again](#schritte).\n",
    );
    expect(html).toContain('<h1 id="uberblick">');
    expect(html).toContain('<h2 id="s-2-schritte">');
    expect(html).toContain('<h2 id="schritte">');
    expect(html).toContain('<a href="#s-2-schritte">steps</a>');
    expect(html).toContain('<a href="#schritte">again</a>');
  });

  it("keeps list structure valid: tight, loose, nested, numbered and task lists", async () => {
    const md =
      "# T\n\n3. three\n4. four\n   - nested\n\n- [x] done\n- [ ] todo\n\n* loose\n\n* items\n";
    const html = body(md);
    expect(html).toContain(
      '<ol start="3"><li>three</li><li><p>four</p><ul><li>nested</li></ul></li></ol>',
    );
    expect(html).toContain("<li>☑ done</li><li>☐ todo</li>");
    expect(html).toContain("<ul><li><p>loose</p></li><li><p>items</p></li></ul>");
    expect((await validate(await build(fromMarkdown(md, { language: "en" })))).valid).toBe(true);
  });

  it("converts tables, code and inline formatting", () => {
    const html = body(
      "# T\n\n| a | b |\n|---|---|\n| `x` | ~~y~~ |\n\n```js\nlet a = 1 < 2;\n```\n\nA  \nB *c* **d**\n",
    );
    expect(html).toContain(
      '<table id="table"><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead><tbody><tr><td><code>x</code></td><td><s>y</s></td></tr></tbody></table>',
    );
    expect(html).toContain("<pre><code>let a = 1 &lt; 2;</code></pre>");
    expect(html).toContain("<p>A<br/>B <em>c</em> <strong>d</strong></p>");
  });

  it("embeds local images and replaces unusable ones with their alt text", () => {
    const files: Record<string, Uint8Array> = {
      "img/a.png": PNG,
      "img/bad.bin": new Uint8Array([1, 2, 3]),
    };
    const r = fromMarkdown(
      "# T\n\n![Alt](img/a.png)\n\nInline ![A](img/a.png) again.\n\n![Remote](https://example.org/x.png)\n\n![Gone](img/none.png)\n\n![Bad](img/bad.bin)\n\n![Up](../../etc/passwd)\n",
      { language: "en", readFile: (p) => files[p] },
    );
    const html = r.chapters[0]?.body ?? "";
    expect(r.assets).toHaveLength(1);
    expect(html).toContain('<figure id="alt"><img src="../assets/a.png" alt="Alt"/></figure>');
    expect(html).toContain('<p>Inline <img src="../assets/a.png" alt="A"/> again.</p>');
    expect(html).toContain("<p>Remote</p>");
    expect(html).toContain("<p>Gone</p>");
    expect(html).toContain("<p>Up</p>");
    expect(r.warnings).toEqual([
      "Remote images are not allowed and were replaced by their alt text: https://example.org/x.png",
      "Image not found: img/none.png (its alt text is shown instead)",
      "Unsupported image format: img/bad.bin (use PNG, JPEG, GIF, WebP or SVG)",
    ]);
  });

  it("drops raw HTML and unsafe links but keeps their text", async () => {
    const md =
      "# T\n\n<script>alert(1)</script>\n\nPress <kbd>Ctrl</kbd>. [x](javascript:alert(1)) [y](notes.pdf) [z](#nowhere) [w](http://example.org)\n\nBad\u0001char.\n";
    const r = fromMarkdown(md, { language: "en" });
    const html = r.chapters[0]?.body ?? "";
    expect(html).not.toContain("script");
    expect(html).not.toContain("kbd");
    expect(html).toContain("Press Ctrl.");
    expect(html).toContain(
      '<span>x</span> <span>y</span> <span>z</span> <a href="http://example.org">w</a>',
    );
    expect(html).toContain("Badchar.");
    expect(r.warnings).toEqual([
      "Raw HTML blocks are not supported and were left out",
      "Inline HTML tags are not supported; their text was kept",
      "Links with the scheme of javascript:alert(1) are not allowed; the link text was kept",
      "Links to files outside the document are not allowed; the link text was kept: notes.pdf",
      "Broken link to #nowhere in index.md",
    ]);
    expect((await validate(await build(r))).valid).toBe(true);
  });

  it("reads simple front matter", () => {
    expect(
      frontMatter('---\ntitle: "A: B"\nlang: de\nauthor:\n  - Ann\n  - Bo\n---\n# X\n'),
    ).toEqual({
      meta: { title: "A: B", language: "de", authors: ["Ann", "Bo"] },
      body: "# X\n",
    });
    const r = fromMarkdown("---\ntitle: Front\nlang: de\n---\nText.\n");
    expect([r.title, r.language, r.warnings]).toEqual(["Front", "de", []]);
    expect(fromMarkdown("Text.\n").warnings).toContain(
      "No document language given; using en (set it with --lang or front matter lang:)",
    );
  });
});

const str = (s: string) =>
  s.split(/(\s)/).flatMap((w) => (w === " " ? [{ t: "Space" }] : w ? [{ t: "Str", c: w }] : []));
const para = (s: string) => ({ t: "Para", c: str(s) });
const plain = (s: string) => ({ t: "Plain", c: str(s) });
const A = (id = "", classes: string[] = [], kv: [string, string][] = []) => [id, classes, kv];
const cell = (s: string, rs = 1, cs = 1) => [A(), { t: "AlignDefault" }, rs, cs, [plain(s)]];
const doc = (blocks: unknown[], meta: Record<string, unknown> = {}): PandocDocument =>
  ({ "pandoc-api-version": [1, 23, 1], meta, blocks }) as PandocDocument;

describe("fromPandoc", () => {
  it(
    "converts the DOCX sample with Word styles for callouts and captions",
    { skip: !hasPandoc() },
    async () => {
      const media = mkdtempSync(join(tmpdir(), "flexova-docx-"));
      const json = execFileSync(
        "pandoc",
        [
          "-f",
          "docx+styles",
          "-t",
          "json",
          `--extract-media=${media}`,
          sample("docx/field-guide.docx").pathname,
        ],
        { encoding: "utf8" },
      );
      const r = fromPandoc(JSON.parse(json), {
        language: "en-GB",
        readFile: (p) => readFileSync(p),
      });
      expect([r.title, r.language, r.authors, r.warnings]).toEqual([
        "Aurora P2 Quick Reference",
        "en-GB",
        ["Flexova Samples"],
        [],
      ]);
      const [one, two] = r.chapters.map((c) => c.body);
      expect(one).toContain(
        '<aside role="note" data-flexova-variant="warning"><p><strong>Warning</strong></p><p>Never run the pump dry for more than 30 seconds.</p><p>Keep children and animals away while the engine runs.</p></aside>',
      );
      expect(one).toMatch(
        /<figure id="[^"]+"><img src="\.\.\/assets\/[^"]+\.png" alt="The front panel[^"]*"\/><figcaption>The front panel/,
      );
      expect(two).toContain("<caption>Flow at each pressure setting</caption>");
      expect(two).not.toContain("<p>Flow at each pressure setting</p>");
      expect(two).toContain('<a href="01.xhtml#before-you-start">Before you start</a>');
      expect((await validate(await build(r))).codes).toEqual([]);
    },
  );

  it("maps tables with spans, header and footer rows", async () => {
    const row = (cells: unknown[]) => [A(), cells];
    const table = {
      t: "Table",
      c: [
        A(),
        [null, [plain("Spans")]],
        [],
        [A(), [row([cell("H1", 1, 2)])]],
        [[A(), 0, [], [row([cell("a", 2), cell("b")]), row([cell("c")])]]],
        [A(), [row([cell("f1"), cell("f2")])]],
      ],
    };
    const r = fromPandoc(doc([{ t: "Header", c: [1, A("t"), str("T")] }, table]), {
      language: "en",
    });
    expect(r.chapters[0]?.body).toContain(
      '<table id="spans"><caption>Spans</caption><thead><tr><th scope="col" colspan="2">H1</th></tr></thead><tbody><tr><td rowspan="2">a</td><td>b</td></tr><tr><td>c</td></tr></tbody><tfoot><tr><td>f1</td><td>f2</td></tr></tfoot></table>',
    );
    expect((await validate(await build(r))).valid).toBe(true);
  });

  it("maps definition lists, quotes, notes across chapters, anchors and styled callouts", async () => {
    const r = fromPandoc(
      doc(
        [
          { t: "Header", c: [1, A("one"), str("One")] },
          { t: "DefinitionList", c: [[str("Term"), [[plain("Meaning")]]]] },
          {
            t: "Para",
            c: [
              { t: "Quoted", c: [{ t: "DoubleQuote" }, str("hi")] },
              { t: "Note", c: [para("A note.")] },
              { t: "Span", c: [A("mark"), str("here")] },
            ],
          },
          { t: "Div", c: [A("", ["warning"]), [para("Fenced div callout.")]] },
          { t: "Div", c: [A("", [], [["custom-style", "Hinweis"]]), [para("Mapped style.")]] },
          { t: "Header", c: [1, A("two"), str("Two")] },
          {
            t: "Para",
            c: [
              { t: "Link", c: [A(), str("back"), ["#mark", ""]] },
              { t: "Math", c: [{ t: "InlineMath" }, "x^2"] },
              { t: "RawInline", c: ["html", "<b>"] },
            ],
          },
        ],
        { title: { t: "MetaInlines", c: str("Meta title") }, lang: { t: "MetaString", c: "de" } },
      ),
      { styleMap: { Hinweis: "note" } },
    );
    expect([r.title, r.language]).toEqual(["Meta title", "de"]);
    const [one, two] = r.chapters.map((c) => c.body);
    expect(one).toContain("<dl><dt>Term</dt><dd>Meaning</dd></dl>");
    expect(one).toContain(
      '<p>“hi”<sup><a href="#fn-1" id="fnref-1">1</a></sup><span id="mark">here</span></p>',
    );
    expect(one).toContain(
      'data-flexova-variant="warning"><p><strong>Warning</strong></p><p>Fenced div callout.</p>',
    );
    expect(one).toContain(
      'data-flexova-variant="note"><p><strong>Note</strong></p><p>Mapped style.</p>',
    );
    expect(two).toContain('<a href="01.xhtml#mark">back</a><code>x^2</code>');
    expect(r.warnings).toEqual([
      "Math was kept as TeX source; Flexova expects MathML",
      "Raw html content is not supported and was left out",
    ]);
    expect((await validate(await build(r))).valid).toBe(true);
  });

  it("rejects unsupported Pandoc API versions", () => {
    expect(() => fromPandoc({ ...doc([]), "pandoc-api-version": [1, 17] })).toThrow(
      /unsupported Pandoc API/,
    );
  });
});
