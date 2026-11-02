// DocumentBuilder: shared by the importers. It splits content into chapters, allocates unique ids, collects
// assets, resolves links across chapters and sources once everything is known, and renders footnotes.
import type { Asset, Chapter } from "@flexova/core";
import { asBlocks, el, serialize, textOf, type El, type Node } from "./tree.js";

export interface Labels {
  note: string;
  tip: string;
  important: string;
  warning: string;
  caution: string;
  notes: string;
  untitled: string;
}

export const DEFAULT_LABELS: Labels = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
  notes: "Notes",
  untitled: "Untitled document",
};

export interface ImportOptions {
  /** Document title; overrides front matter or metadata and the first heading. */
  title?: string;
  /** BCP 47 language tag; overrides front matter or metadata. Defaults to "en", with a warning. */
  language?: string;
  authors?: string[];
  /** Load a file the source references (an image), by its path relative to the source root. */
  readFile?: (path: string) => Uint8Array | undefined;
  /** Callout labels and the notes heading, for documents not in English. */
  labels?: Partial<Labels>;
}

export interface ImportResult {
  title: string;
  language: string;
  authors: string[];
  chapters: Chapter[];
  assets: Asset[];
  /** Content that could not be represented and was simplified or dropped. */
  warnings: string[];
}

export interface Metadata {
  title?: string | undefined;
  language?: string | undefined;
  authors?: string[] | undefined;
}

type Target =
  | { kind: "anchor"; source: string; key: string }
  | { kind: "source"; source: string }
  | { kind: "id"; id: string; chapter: number };

interface ChapterDraft {
  title: string | null;
  source: string;
  blocks: Node[];
  notes: El[];
}

export type Variant = "note" | "tip" | "important" | "warning" | "caution";

/** An ASCII id that matches the profile's id pattern. */
export function slug(text: string): string {
  const ascii = text
    .split(/\s+/)
    .slice(0, 6)
    .join(" ")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  if (!ascii) return "section";
  return /^[a-z]/.test(ascii) ? ascii : `s-${ascii}`;
}

/** The anchor GitHub and most Markdown tools give a heading, which authors write in links. */
export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

const SIGNATURES: [string, (b: Uint8Array) => boolean][] = [
  ["image/png", (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/gif", (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38],
  [
    "image/webp",
    (b) =>
      String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...b.subarray(8, 12)) === "WEBP",
  ],
  ["image/svg+xml", (b) => /<svg[\s>]/.test(new TextDecoder().decode(b.subarray(0, 4096)))],
];

export function imageType(data: Uint8Array): string | null {
  return SIGNATURES.find(([, test]) => test(data))?.[0] ?? null;
}

/** POSIX-style join of a source's directory and a relative reference; null if it escapes the root. */
export function resolvePath(source: string, ref: string): string | null {
  const parts = source.split("/").slice(0, -1);
  for (const seg of ref.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

export class DocumentBuilder {
  readonly labels: Labels;
  private readonly warned = new Set<string>();
  private readonly chapters: ChapterDraft[] = [];
  private readonly ids = new Set<string>();
  private readonly anchors = new Map<string, { id: string; chapter: number }>();
  private readonly sourceChapter = new Map<string, number>();
  private readonly links: { el: El; target: Target; chapter: number }[] = [];
  private readonly assets = new Map<string, Asset>();
  private readonly assetNames = new Set<string>();

  constructor(private readonly options: ImportOptions) {
    this.labels = { ...DEFAULT_LABELS, ...options.labels };
  }

  warn(message: string): void {
    this.warned.add(message);
  }

  get chapter(): number {
    return this.chapters.length - 1;
  }

  startChapter(title: string | null, source: string): void {
    this.chapters.push({ title, source, blocks: [], notes: [] });
    if (!this.sourceChapter.has(source)) this.sourceChapter.set(source, this.chapter);
  }

  push(...blocks: Node[]): void {
    if (this.chapter < 0) throw new Error("startChapter() first");
    (this.chapters[this.chapter] as ChapterDraft).blocks.push(...blocks);
  }

  /** A document-wide unique id derived from `base`. */
  id(base: string): string {
    const stem = slug(base);
    let id = stem;
    for (let n = 2; this.ids.has(id); n++) id = `${stem}-${n}`;
    this.ids.add(id);
    return id;
  }

  /** Make `id` reachable from links written as `#key` in `source`. The first registration wins. */
  anchor(source: string, key: string, id: string): void {
    const k = `${source}#${key}`;
    if (!this.anchors.has(k)) this.anchors.set(k, { id, chapter: this.chapter });
  }

  /** A link whose href is resolved by finish(), once every chapter and anchor is known. */
  link(children: Node[], target: Target): El {
    const a = el("a", { href: "#" }, children);
    this.links.push({ el: a, target, chapter: this.chapter });
    return a;
  }

  /** Add an image file and return its src relative to a chapter, or null (with a warning) if unusable. */
  image(path: string, data?: Uint8Array): string | null {
    const existing = this.assets.get(path);
    if (existing) return `../${existing.path}`;
    const bytes = data ?? this.options.readFile?.(path);
    if (!bytes) {
      this.warn(`Image not found: ${path} (its alt text is shown instead)`);
      return null;
    }
    const mediaType = imageType(bytes);
    if (!mediaType) {
      this.warn(`Unsupported image format: ${path} (use PNG, JPEG, GIF, WebP or SVG)`);
      return null;
    }
    const base = (path.split("/").pop() ?? "image")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[.-]+/, "");
    const dot = base.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base || "image", ""];
    let name = `assets/${stem}${ext}`;
    for (let n = 2; this.assetNames.has(name.toLowerCase()); n++)
      name = `assets/${stem}-${n}${ext}`;
    this.assetNames.add(name.toLowerCase());
    this.assets.set(path, { path: name, mediaType, data: bytes });
    return `../${name}`;
  }

  /** A callout: an aside with a visible label, in the profile's note variants. */
  callout(variant: Variant, blocks: Node[]): El {
    return el("aside", { role: "note", "data-flexova-variant": variant }, [
      el("p", {}, [el("strong", {}, [this.labels[variant]])]),
      ...asBlocks(blocks),
    ]);
  }

  /**
   * A footnote reference. The note is created in the current chapter on first use (render() supplies its
   * content); later references in any chapter link to the same note.
   */
  noteRef(key: string, render: () => Node[]): El {
    let note = this.notes.get(key);
    let refId: string | undefined;
    if (!note) {
      const number = (this.chapters[this.chapter] as ChapterDraft).notes.length + 1;
      note = { id: this.id(`fn-${number}`), chapter: this.chapter, number };
      refId = this.id(`fnref-${number}`);
      this.notes.set(key, note);
      const content = asBlocks(render());
      const back = el("a", { href: `#${refId}` }, ["↩"]);
      const last = content[content.length - 1];
      if (last && typeof last !== "string" && last.name === "p") last.children.push(" ", back);
      else content.push(el("p", {}, [back]));
      (this.chapters[note.chapter] as ChapterDraft).notes.push(el("li", { id: note.id }, content));
    }
    const a = this.link([String(note.number)], { kind: "id", id: note.id, chapter: note.chapter });
    if (refId) a.attrs.id = refId;
    return el("sup", {}, [a]);
  }

  private readonly notes = new Map<string, { id: string; chapter: number; number: number }>();

  finish(meta: Metadata): ImportResult {
    const keep = this.chapters.map((c) => c.blocks.length > 0 || c.notes.length > 0);
    const index = new Map<number, number>();
    keep.forEach((k, i) => k && index.set(i, index.size));
    const drafts = this.chapters.filter((_, i) => keep[i]);
    if (!drafts.length) throw new Error("the document has no content");
    const width = drafts.length >= 100 ? 3 : 2;
    const file = (i: number) => `${String(i + 1).padStart(width, "0")}.xhtml`;

    for (const { el: a, target, chapter } of this.links) {
      const here = index.get(chapter);
      let href: string | null = null;
      if (target.kind === "id" || target.kind === "anchor") {
        const hit =
          target.kind === "id" ? target : this.anchors.get(`${target.source}#${target.key}`);
        const there = hit && index.get(hit.chapter);
        if (hit && there !== undefined)
          href = there === here ? `#${hit.id}` : `${file(there)}#${hit.id}`;
        else if (target.kind === "anchor")
          this.warn(`Broken link to #${target.key} in ${target.source}`);
      } else {
        const start = this.sourceChapter.get(target.source);
        const there =
          start === undefined ? undefined : firstKept(index, start, this.chapters.length);
        if (there !== undefined) href = file(there);
      }
      if (href) a.attrs.href = href;
      else {
        a.name = "span";
        a.attrs = {};
      }
    }

    const title = (
      this.options.title ??
      meta.title ??
      drafts.find((d) => d.title)?.title ??
      ""
    ).trim();
    const docTitle = title || this.labels.untitled;
    let language = this.options.language ?? meta.language;
    if (!language) {
      language = "en";
      this.warn("No document language given; using en (set it with --lang or front matter lang:)");
    }
    const chapters: Chapter[] = drafts.map((d, i) => {
      const firstHeading = d.blocks.find((b) => typeof b !== "string" && /^h[1-6]$/.test(b.name));
      const chapterTitle =
        d.title ??
        (firstHeading
          ? textOf([firstHeading])
          : i === 0
            ? docTitle
            : d.source.replace(/^.*\/|\.[^.]*$/g, ""));
      const blocks = asBlocks(d.blocks);
      const first = blocks[0];
      if (!(first && typeof first !== "string" && first.name === "h1")) {
        blocks.unshift(el("h1", { id: this.id(chapterTitle) }, [chapterTitle]));
      }
      if (d.notes.length) {
        blocks.push(
          el("section", { role: "doc-endnotes", "epub:type": "endnotes" }, [
            el("h2", { id: this.id(`notes-${i + 1}`) }, [this.labels.notes]),
            el("ol", {}, d.notes),
          ]),
        );
      }
      const section = el("section", { role: "doc-chapter", "epub:type": "chapter" }, blocks);
      return { title: chapterTitle, body: serialize(section), file: file(i) };
    });
    return {
      title: docTitle,
      language,
      authors: this.options.authors ?? meta.authors ?? [],
      chapters,
      assets: [...this.assets.values()],
      warnings: [...this.warned],
    };
  }
}

function firstKept(index: Map<number, number>, from: number, total: number): number | undefined {
  for (let i = from; i < total; i++) {
    const mapped = index.get(i);
    if (mapped !== undefined) return mapped;
  }
  return undefined;
}
