// Pandoc's JSON syntax tree (pandoc-types 1.23, from `pandoc -t json`) to Flexova chapters. This covers
// every format Pandoc reads: DOCX, ODT, HTML, LaTeX, reStructuredText and more.
import {
  DocumentBuilder,
  type ImportOptions,
  type ImportResult,
  type Variant,
} from "./document.js";
import { asBlocks, asFlow, el, textOf, tidy, trim, type El, type Node } from "./tree.js";

/** A Pandoc AST node: `{ t: "Para", c: [...] }`. */
interface PNode {
  t: string;
  c?: unknown;
}
type Attr = [string, string[], [string, string][]];
type Row = [Attr, Cell[]];
type Cell = [Attr, PNode, number, number, PNode[]];

export interface PandocDocument {
  "pandoc-api-version": number[];
  meta: Record<string, PNode>;
  blocks: PNode[];
}

export interface PandocOptions extends ImportOptions {
  /**
   * Paragraph styles (DOCX/ODT `custom-style`, read with `-f docx+styles`) or Div classes that become
   * callouts, by case-insensitive name. Defaults map Note, Tip, Important, Warning and Caution.
   */
  styleMap?: Record<string, Variant>;
}

const VARIANTS: Variant[] = ["note", "tip", "important", "warning", "caution"];
const EXTERNAL = /^(https?:|mailto:)/i;
const SOURCE = "document";

const attrOf = (a: unknown): { id: string; classes: string[]; kv: Map<string, string> } => {
  const [id, classes, kv] = (a as Attr | undefined) ?? ["", [], []];
  return { id, classes, kv: new Map(kv) };
};

const CAPTION_STYLES = new Set(["caption", "image caption", "figure caption"]);

const styleOf = (block: PNode): string | null =>
  block.t === "Div"
    ? (attrOf((block.c as [Attr])[0])
        .kv.get("custom-style")
        ?.toLowerCase() ?? null)
    : null;

/** The image of a paragraph that holds only an image (possibly inside a styled Div), else null. */
function imageOnly(block: PNode): PNode | null {
  if (block.t === "Div") {
    const children = (block.c as [Attr, PNode[]])[1];
    return children.length === 1 && children[0] ? imageOnly(children[0]) : null;
  }
  if (block.t !== "Para" && block.t !== "Plain") return null;
  const meaningful = (block.c as PNode[]).filter((n) => n.t !== "Space" && n.t !== "SoftBreak");
  return meaningful.length === 1 && meaningful[0]?.t === "Image" ? meaningful[0] : null;
}

class PandocConverter {
  private readonly styles: Map<string, Variant>;
  private notes = 0;

  constructor(
    private readonly b: DocumentBuilder,
    options: PandocOptions,
  ) {
    this.styles = new Map(VARIANTS.map((v) => [v, v]));
    for (const [name, variant] of Object.entries(options.styleMap ?? {})) {
      this.styles.set(name.toLowerCase(), variant);
    }
  }

  convert(blocks: PNode[]): void {
    let started = false;
    for (const block of this.mergeCallouts(blocks)) {
      if (block.t === "Header" && (block.c as [number])[0] === 1) {
        const [, attr, inlines] = block.c as [number, Attr, PNode[]];
        const inline = this.inlines(inlines);
        this.b.startChapter(textOf(inline).trim(), SOURCE);
        started = true;
        this.b.push(this.heading(1, attr, inline));
        continue;
      }
      const out = this.block(block);
      if (!out.length) continue;
      if (!started) {
        this.b.startChapter(null, SOURCE);
        started = true;
      }
      this.b.push(...out);
    }
  }

  private variantOf(block: PNode): Variant | null {
    if (block.t !== "Div") return null;
    const { classes, kv } = attrOf((block.c as [Attr])[0]);
    for (const name of [kv.get("custom-style") ?? "", ...classes]) {
      const v = this.styles.get(name.toLowerCase());
      if (v) return v;
    }
    return null;
  }

  /** Word and ODT wrap each styled paragraph separately; merge consecutive ones into one callout. */
  private mergeCallouts(blocks: PNode[]): PNode[] {
    const out: PNode[] = [];
    for (const block of blocks) {
      const variant = this.variantOf(block);
      const last = out[out.length - 1];
      if (block.t === "Table" && last && styleOf(last) === "table caption") {
        // Word puts a table's caption in a paragraph before it; Pandoc also copies it into the table.
        const c = block.c as unknown[];
        const caption = c[1] as [unknown, PNode[]];
        out[out.length - 1] = caption[1].length
          ? block
          : { t: "Table", c: [c[0], [null, (last.c as [Attr, PNode[]])[1]], ...c.slice(2)] };
        continue;
      }
      const image = last && imageOnly(last);
      if (image && last && styleOf(block) && CAPTION_STYLES.has(styleOf(block) as string)) {
        // Word: an image paragraph followed by a caption paragraph is one captioned figure.
        const caption = (block.c as [Attr, PNode[]])[1];
        out[out.length - 1] = {
          t: "Figure",
          c: [["", [], []], [null, caption], [{ t: "Plain", c: [image] }]],
        };
      } else if (variant && last && this.variantOf(last) === variant) {
        const [attr, children] = last.c as [Attr, PNode[]];
        out[out.length - 1] = {
          t: "Div",
          c: [attr, [...children, ...(block.c as [Attr, PNode[]])[1]]],
        };
      } else out.push(block);
    }
    return out;
  }

  private heading(level: number, attr: Attr, inline: Node[]): El {
    const { id: given } = attrOf(attr);
    const text = textOf(inline).trim();
    const id = this.b.id(given || text);
    if (given) this.b.anchor(SOURCE, given, id);
    return el(`h${Math.min(Math.max(level, 1), 6)}`, { id }, inline);
  }

  private blocks(blocks: PNode[]): Node[] {
    return this.mergeCallouts(blocks).flatMap((b) => this.block(b));
  }

  private block(block: PNode): Node[] {
    const c = block.c as never;
    switch (block.t) {
      case "Plain":
        return this.inlines(c);
      case "Para": {
        const meaningful = (c as PNode[]).filter((n) => n.t !== "Space" && n.t !== "SoftBreak");
        if (meaningful.length === 1 && meaningful[0]?.t === "Image")
          return [this.figure(meaningful[0], null)];
        const inline = trim(this.inlines(c));
        return inline.length ? [el("p", {}, inline)] : [];
      }
      case "LineBlock": {
        const lines = (c as PNode[][]).map((l) => this.inlines(l));
        return [
          el(
            "p",
            {},
            lines.flatMap((l, i) => (i ? [el("br"), ...l] : l)),
          ),
        ];
      }
      case "CodeBlock":
        return [el("pre", {}, [el("code", {}, [(c as [Attr, string])[1]])])];
      case "RawBlock":
        this.b.warn(`Raw ${(c as [string])[0]} blocks are not supported and were left out`);
        return [];
      case "BlockQuote":
        return [el("blockquote", {}, asBlocks(this.blocks(c)))];
      case "OrderedList": {
        const [[start], items] = c as [[number], PNode[][]];
        return [
          el(
            "ol",
            start !== 1 ? { start: String(start) } : {},
            items.map((i) => el("li", {}, asFlow(this.blocks(i)))),
          ),
        ];
      }
      case "BulletList":
        return [
          el(
            "ul",
            {},
            (c as PNode[][]).map((i) => el("li", {}, asFlow(this.blocks(i)))),
          ),
        ];
      case "DefinitionList": {
        const items = c as [PNode[], PNode[][]][];
        return [
          el(
            "dl",
            {},
            items.flatMap(([term, defs]) => [
              el("dt", {}, this.inlines(term)),
              ...(defs.length ? defs : [[]]).map((d) => el("dd", {}, asFlow(this.blocks(d)))),
            ]),
          ),
        ];
      }
      case "Header": {
        const [level, attr, inlines] = c as [number, Attr, PNode[]];
        return [this.heading(level, attr, this.inlines(inlines))];
      }
      case "HorizontalRule":
        return [el("hr")];
      case "Table":
        return [this.table(c)];
      case "Figure": {
        const [attr, [, caption], content] = c as [Attr, [unknown, PNode[]], PNode[]];
        return [this.figureBlock(attr, caption, content)];
      }
      case "Div": {
        const [attr, children] = c as [Attr, PNode[]];
        const variant = this.variantOf(block);
        const inner = this.blocks(children);
        const { id } = attrOf(attr);
        if (id) this.b.anchor(SOURCE, id, this.anchorTarget(inner));
        return variant ? [this.b.callout(variant, inner)] : inner;
      }
      default:
        return [];
    }
  }

  /** An id for links to a Div: its first heading's id, or a new id on an empty span. */
  private anchorTarget(inner: Node[]): string {
    const heading = inner.find((n): n is El => typeof n !== "string" && /^h[1-6]$/.test(n.name));
    return heading?.attrs.id ?? this.b.id("anchor");
  }

  private table(c: unknown): El {
    const [, [, caption], , [, headRows], bodies, [, footRows]] = c as [
      Attr,
      [unknown, PNode[]],
      unknown,
      [Attr, Row[]],
      [Attr, number, Row[], Row[]][],
      [Attr, Row[]],
    ];
    const row = ([, cells]: Row, header: boolean) =>
      el(
        "tr",
        {},
        cells.map(([, , rowspan, colspan, content]) =>
          el(
            header ? "th" : "td",
            {
              ...(header ? { scope: "col" } : {}),
              ...(rowspan > 1 ? { rowspan: String(rowspan) } : {}),
              ...(colspan > 1 ? { colspan: String(colspan) } : {}),
            },
            asFlow(this.blocks(content)),
          ),
        ),
      );
    const bodyRows = bodies.flatMap(([, , head, body]) => [
      ...head.map((r) => row(r, true)),
      ...body.map((r) => row(r, false)),
    ]);
    const parts: El[] = [];
    const captionText = tidy(
      this.blocks(caption).flatMap((n) => (typeof n === "string" ? [n] : n.children)),
    );
    if (captionText.length) parts.push(el("caption", {}, captionText));
    if (headRows.length && bodyRows.length)
      parts.push(
        el(
          "thead",
          {},
          headRows.map((r) => row(r, true)),
        ),
      );
    parts.push(el("tbody", {}, bodyRows.length ? bodyRows : headRows.map((r) => row(r, true))));
    if (footRows.length)
      parts.push(
        el(
          "tfoot",
          {},
          footRows.map((r) => row(r, false)),
        ),
      );
    return el("table", { id: this.b.id(textOf(captionText) || "table") }, parts);
  }

  private figure(image: PNode, caption: Node[] | null): El {
    const img = this.image(image);
    const [, , [, title]] = image.c as [Attr, PNode[], [string, string]];
    const text = caption ?? (title && title !== "fig:" ? [title.replace(/^fig:/, "")] : []);
    if (typeof img === "string") return el("p", {}, [img]);
    return el("figure", { id: this.b.id(textOf(text) || img.attrs.alt || "figure") }, [
      img,
      ...(text.length ? [el("figcaption", {}, asFlow(text))] : []),
    ]);
  }

  private figureBlock(attr: Attr, caption: PNode[], content: PNode[]): El {
    const captionNodes = this.blocks(caption).flatMap((n) =>
      typeof n === "string" ? [n] : n.name === "p" ? n.children : [n],
    );
    const images = content.flatMap((b) =>
      b.t === "Plain" || b.t === "Para" ? (b.c as PNode[]).filter((i) => i.t === "Image") : [],
    );
    if (images.length === 1 && images[0]) return this.figure(images[0], captionNodes);
    const inner = this.blocks(content);
    const { id } = attrOf(attr);
    return el("figure", { id: this.b.id(id || textOf(captionNodes) || "figure") }, [
      ...asBlocks(inner).filter(
        (n) => typeof n !== "string" && ["p", "table", "pre", "blockquote"].includes(n.name),
      ),
      ...(captionNodes.length ? [el("figcaption", {}, asFlow(captionNodes))] : []),
    ]);
  }

  private image(node: PNode): El | string {
    const [, alt, [url]] = node.c as [Attr, PNode[], [string, string]];
    const altText = textOf(this.inlines(alt)).trim();
    if (!altText)
      this.b.warn(`Image without alt text: ${url} (add a description for screen readers)`);
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url)) {
      this.b.warn(`Remote images are not allowed and were replaced by their alt text: ${url}`);
      return altText;
    }
    const src = this.b.image(url.replace(/^file:\/\//i, ""));
    return src ? el("img", { src, alt: altText }) : altText;
  }

  inlines(nodes: PNode[]): Node[] {
    return tidy(nodes.flatMap((n) => this.inline(n)));
  }

  private inline(node: PNode): Node[] {
    const c = node.c as never;
    switch (node.t) {
      case "Str":
        return [c];
      case "Space":
      case "SoftBreak":
        return [" "];
      case "LineBreak":
        return [el("br")];
      case "Emph":
        return [el("em", {}, this.inlines(c))];
      case "Strong":
        return [el("strong", {}, this.inlines(c))];
      case "Strikeout":
        return [el("s", {}, this.inlines(c))];
      case "Superscript":
        return [el("sup", {}, this.inlines(c))];
      case "Subscript":
        return [el("sub", {}, this.inlines(c))];
      case "Underline":
      case "SmallCaps":
        return this.inlines(c);
      case "Quoted": {
        const [kind, inner] = c as [PNode, PNode[]];
        const [open, close] = kind.t === "SingleQuote" ? ["‘", "’"] : ["“", "”"];
        return [open, ...this.inlines(inner), close];
      }
      case "Cite":
        return this.inlines((c as [unknown, PNode[]])[1]);
      case "Code":
        return [el("code", {}, [(c as [Attr, string])[1]])];
      case "Math":
        this.b.warn("Math was kept as TeX source; Flexova expects MathML");
        return [el("code", {}, [(c as [PNode, string])[1]])];
      case "RawInline":
        this.b.warn(`Raw ${(c as [string])[0]} content is not supported and was left out`);
        return [];
      case "Link": {
        const [, inner, [url]] = c as [Attr, PNode[], [string, string]];
        return [this.anchor(url, this.inlines(inner))];
      }
      case "Image":
        return [this.image(node)];
      case "Note":
        return [this.b.noteRef(`note-${++this.notes}`, () => this.blocks(c))];
      case "Span": {
        const [attr, inner] = c as [Attr, PNode[]];
        const { id } = attrOf(attr);
        const children = this.inlines(inner);
        if (!id) return children;
        const ref = this.b.id(id);
        this.b.anchor(SOURCE, id, ref);
        return [el("span", { id: ref }, children)];
      }
      default:
        return [];
    }
  }

  private anchor(url: string, children: Node[]): Node {
    if (EXTERNAL.test(url)) return el("a", { href: url }, children);
    if (url.startsWith("#"))
      return this.b.link(children, { kind: "anchor", source: SOURCE, key: url.slice(1) });
    this.b.warn(
      `Links to files outside the document are not allowed; the link text was kept: ${url}`,
    );
    return el("span", {}, children);
  }
}

function metaText(value: PNode | undefined, b: PandocConverter): string | undefined {
  if (!value) return undefined;
  if (value.t === "MetaString") return value.c as string;
  if (value.t === "MetaInlines" || value.t === "MetaBlocks") {
    return textOf(b.inlines(value.c as PNode[])).trim() || undefined;
  }
  return undefined;
}

/** Convert a Pandoc JSON document (`pandoc -t json`) into Flexova chapters and assets. */
export function fromPandoc(doc: PandocDocument, options: PandocOptions = {}): ImportResult {
  const [major, minor] = doc["pandoc-api-version"] ?? [];
  if (major !== 1 || (minor ?? 0) < 22) {
    throw new Error(
      `unsupported Pandoc API version ${doc["pandoc-api-version"]?.join(".")} (need 1.22 or later)`,
    );
  }
  const b = new DocumentBuilder(options);
  const converter = new PandocConverter(b, options);
  converter.convert(doc.blocks);
  const author = doc.meta.author;
  const authors =
    author?.t === "MetaList"
      ? (author.c as PNode[]).map((a) => metaText(a, converter)).filter((a): a is string => !!a)
      : [metaText(author, converter)].filter((a): a is string => !!a);
  return b.finish({
    title: metaText(doc.meta.title, converter),
    language: metaText(doc.meta.lang, converter),
    ...(authors.length ? { authors } : {}),
  });
}
