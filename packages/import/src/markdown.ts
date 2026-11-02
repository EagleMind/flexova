// Markdown (CommonMark + GitHub Flavored Markdown) to Flexova chapters, via the mdast syntax tree.
import type {
  Definition,
  FootnoteDefinition,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast";
import { fromMarkdown as parseMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import {
  DocumentBuilder,
  githubSlug,
  resolvePath,
  type ImportOptions,
  type ImportResult,
  type Metadata,
  type Variant,
} from "./document.js";
import { asBlocks, asFlow, el, textOf, tidy, trim, type El, type Node } from "./tree.js";

export interface MarkdownSource {
  /** Path relative to the document root, e.g. "chapters/01-intro.md". Used to resolve images and links. */
  path: string;
  text: string;
}

const ALERT = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/i;
const EXTERNAL = /^(https?:|mailto:)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MARKDOWN_FILE = /\.(md|markdown|mdown|mkd)$/i;

/**
 * Parse optional front matter: `---` lines around simple `key: value` pairs. Recognized keys are title,
 * lang (or language), and author (a value, or a list of `- name` lines).
 */
export function frontMatter(text: string): { meta: Metadata; body: string } {
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text.replace(/^\uFEFF/, "") };
  const meta: Metadata = {};
  let listKey: string | null = null;
  const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, "$2");
  for (const line of (match[1] as string).split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      if (listKey === "author" || listKey === "authors")
        (meta.authors ??= []).push(unquote(item[1] as string));
      continue;
    }
    const pair = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = (pair[1] as string).toLowerCase();
    const value = unquote(pair[2] as string);
    listKey = value ? null : key;
    if (!value) continue;
    if (key === "title") meta.title = value;
    else if (key === "lang" || key === "language") meta.language = value;
    else if (key === "author" || key === "authors") meta.authors = [value];
  }
  return { meta, body: text.slice(match[0].length) };
}

class MarkdownConverter {
  private definitions = new Map<string, Definition>();
  private footnotes = new Map<string, FootnoteDefinition>();
  private headingSlugs = new Map<string, number>();
  private source = "";

  constructor(
    private readonly b: DocumentBuilder,
    private readonly sources: Set<string>,
  ) {}

  convert(source: string, root: Root): void {
    this.source = source;
    this.definitions = new Map();
    this.footnotes = new Map();
    this.headingSlugs = new Map();
    for (const node of root.children) {
      if (node.type === "definition") this.definitions.set(node.identifier, node);
      if (node.type === "footnoteDefinition") this.footnotes.set(node.identifier, node);
    }
    let started = false;
    for (const node of root.children) {
      if (node.type === "heading" && node.depth === 1) {
        const inline = this.inline(node.children);
        this.b.startChapter(textOf(inline).trim(), source);
        started = true;
        this.b.push(this.heading(1, inline));
        continue;
      }
      const blocks = this.block(node);
      if (!blocks.length) continue;
      if (!started) {
        this.b.startChapter(null, source);
        started = true;
      }
      this.b.push(...blocks);
    }
  }

  private heading(depth: number, inline: Node[]): El {
    const text = textOf(inline).trim();
    const id = this.b.id(text);
    let key = githubSlug(text);
    const seen = this.headingSlugs.get(key) ?? 0;
    this.headingSlugs.set(key, seen + 1);
    if (seen) key = `${key}-${seen}`;
    this.b.anchor(this.source, key, id);
    this.b.anchor(this.source, id, id);
    return el(`h${depth}`, { id }, inline);
  }

  private blocks(nodes: RootContent[]): Node[] {
    return nodes.flatMap((n) => this.block(n));
  }

  private block(node: RootContent): Node[] {
    switch (node.type) {
      case "paragraph": {
        const meaningful = node.children.filter((c) => !(c.type === "text" && !c.value.trim()));
        const only = meaningful.length === 1 ? meaningful[0] : undefined;
        if (only && (only.type === "image" || only.type === "imageReference"))
          return [this.figure(only)];
        const inline = trim(this.inline(node.children));
        return inline.length ? [el("p", {}, inline)] : [];
      }
      case "heading":
        return [this.heading(node.depth, this.inline(node.children))];
      case "thematicBreak":
        return [el("hr")];
      case "blockquote":
        return [this.blockquote(node.children)];
      case "list":
        return [this.list(node)];
      case "code":
        return [el("pre", {}, [el("code", {}, [node.value])])];
      case "table":
        return [this.table(node)];
      case "html":
        if (!/^\s*<!--[\s\S]*-->\s*$/.test(node.value))
          this.b.warn("Raw HTML blocks are not supported and were left out");
        return [];
      case "definition":
      case "footnoteDefinition":
      case "yaml":
        return [];
      default:
        // Phrasing content at block level (rare): keep its text.
        return this.inline([node as PhrasingContent]);
    }
  }

  private blockquote(children: RootContent[]): El {
    const first = children[0];
    const lead = first?.type === "paragraph" ? first.children[0] : undefined;
    const match = lead?.type === "text" ? ALERT.exec(lead.value) : null;
    if (match && first?.type === "paragraph" && lead?.type === "text") {
      const rest = {
        ...first,
        children: [
          { ...lead, value: lead.value.slice(match[0].length) },
          ...first.children.slice(1),
        ],
      };
      const body = this.blocks([rest, ...children.slice(1)] as RootContent[]);
      return this.b.callout((match[1] as string).toLowerCase() as Variant, body);
    }
    return el("blockquote", {}, asBlocks(this.blocks(children)));
  }

  private list(node: List): El {
    const attrs: Record<string, string | undefined> = {};
    if (node.ordered && node.start !== null && node.start !== undefined && node.start !== 1) {
      attrs.start = String(node.start);
    }
    const items = node.children.map((item) =>
      this.listItem(item, node.spread === true || item.spread === true),
    );
    return el(node.ordered ? "ol" : "ul", attrs, items);
  }

  private listItem(item: ListItem, loose: boolean): El {
    const box = item.checked === true ? "☑ " : item.checked === false ? "☐ " : "";
    const nodes: Node[] = [];
    item.children.forEach((child, i) => {
      if (child.type === "paragraph" && !loose) {
        const inline = this.inline(child.children);
        nodes.push(...(i === 0 && box ? [box, ...inline] : inline));
        return;
      }
      const converted = this.block(child);
      const p = converted[0];
      if (i === 0 && box && p && typeof p !== "string" && p.name === "p") p.children.unshift(box);
      nodes.push(...converted);
    });
    return el("li", {}, asFlow(tidy(nodes)));
  }

  private table(node: Table): El {
    const [head, ...body] = node.children;
    const id = this.b.id("table");
    const row = (cells: Node[][], header: boolean) =>
      el(
        "tr",
        {},
        cells.map((c) => el(header ? "th" : "td", header ? { scope: "col" } : {}, asFlow(c))),
      );
    const cells = (r: (typeof node.children)[number]) =>
      r.children.map((c) => this.inline(c.children));
    const parts: El[] = [];
    if (head && body.length) parts.push(el("thead", {}, [row(cells(head), true)]));
    const bodyRows = body.length ? body : head ? [head] : [];
    parts.push(
      el(
        "tbody",
        {},
        bodyRows.map((r) => row(cells(r), !body.length)),
      ),
    );
    return el("table", { id }, parts);
  }

  private figure(node: PhrasingContent): El {
    const img = this.image(node);
    if (typeof img === "string") return el("p", {}, [img]);
    const title =
      node.type === "image"
        ? node.title
        : this.definitions.get((node as { identifier: string }).identifier)?.title;
    return el("figure", { id: this.b.id(title || img.attrs.alt || "figure") }, [
      img,
      ...(title ? [el("figcaption", {}, [title])] : []),
    ]);
  }

  private image(node: PhrasingContent): El | string {
    let url: string;
    let alt: string;
    if (node.type === "image") {
      url = node.url;
      alt = node.alt ?? "";
    } else if (node.type === "imageReference") {
      const def = this.definitions.get(node.identifier);
      if (!def) return `![${node.alt ?? ""}]`;
      url = def.url;
      alt = node.alt ?? "";
    } else return "";
    if (!alt) this.b.warn(`Image without alt text: ${url} (add a description for screen readers)`);
    if (EXTERNAL.test(url) || SCHEME.test(url)) {
      this.b.warn(`Remote images are not allowed and were replaced by their alt text: ${url}`);
      return alt;
    }
    const path = resolvePath(this.source, safeDecode(url.split(/[?#]/)[0] as string));
    const src = path === null ? null : this.b.image(path);
    return src ? el("img", { src, alt }) : alt;
  }

  private inline(nodes: PhrasingContent[]): Node[] {
    return tidy(nodes.flatMap((n) => this.phrasing(n)));
  }

  private phrasing(node: PhrasingContent): Node[] {
    switch (node.type) {
      case "text":
        return [node.value];
      case "emphasis":
        return [el("em", {}, this.inline(node.children))];
      case "strong":
        return [el("strong", {}, this.inline(node.children))];
      case "delete":
        return [el("s", {}, this.inline(node.children))];
      case "inlineCode":
        return [el("code", {}, [node.value])];
      case "break":
        return [el("br")];
      case "link":
        return [this.anchor(node.url, this.inline(node.children))];
      case "linkReference": {
        const def = this.definitions.get(node.identifier);
        const children = this.inline(node.children);
        return def ? [this.anchor(def.url, children)] : ["[", ...children, "]"];
      }
      case "image":
      case "imageReference":
        return [this.image(node)];
      case "footnoteReference": {
        const def = this.footnotes.get(node.identifier);
        if (!def) return [`[^${node.label ?? node.identifier}]`];
        return [
          this.b.noteRef(`${this.source}#${node.identifier}`, () =>
            this.blocks(def.children as RootContent[]),
          ),
        ];
      }
      case "html":
        this.b.warn("Inline HTML tags are not supported; their text was kept");
        return [];
      default:
        return "children" in node
          ? this.inline((node as { children: PhrasingContent[] }).children)
          : [];
    }
  }

  private anchor(url: string, children: Node[]): Node {
    const href = url.trim();
    if (EXTERNAL.test(href)) return el("a", { href }, children);
    if (href.startsWith("#")) {
      return this.b.link(children, {
        kind: "anchor",
        source: this.source,
        key: safeDecode(href.slice(1)),
      });
    }
    if (SCHEME.test(href)) {
      this.b.warn(`Links with the scheme of ${href} are not allowed; the link text was kept`);
      return el("span", {}, children);
    }
    const [file, fragment] = href.split("#", 2) as [string, string | undefined];
    const target = resolvePath(this.source, safeDecode(file));
    if (target !== null && this.sources.has(target)) {
      return fragment
        ? this.b.link(children, { kind: "anchor", source: target, key: safeDecode(fragment) })
        : this.b.link(children, { kind: "source", source: target });
    }
    if (!MARKDOWN_FILE.test(file)) {
      this.b.warn(
        `Links to files outside the document are not allowed; the link text was kept: ${href}`,
      );
    } else this.b.warn(`Link to a Markdown file that is not part of the document: ${href}`);
    return el("span", {}, children);
  }
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Convert one or more Markdown files (in reading order) into Flexova chapters and assets. */
export function fromMarkdown(
  input: string | MarkdownSource[],
  options: ImportOptions = {},
): ImportResult {
  const sources = typeof input === "string" ? [{ path: "index.md", text: input }] : input;
  const b = new DocumentBuilder(options);
  const converter = new MarkdownConverter(b, new Set(sources.map((s) => s.path)));
  const meta: Metadata = {};
  for (const source of sources) {
    const { meta: m, body } = frontMatter(source.text);
    meta.title ??= m.title;
    meta.language ??= m.language;
    meta.authors ??= m.authors;
    const root = parseMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
    converter.convert(source.path, root);
  }
  return b.finish(meta);
}
