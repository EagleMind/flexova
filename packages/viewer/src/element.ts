// <flexova-viewer>: a dependency-free web component that displays a Flexova package safely (spec section 9).
import {
  MATHML,
  MEDIA_KINDS,
  XHTML,
  parentDir,
  rebuild,
  resolve,
  rewriteLink,
  type RenderContext,
  type Sink,
  type Source,
} from "./render.js";
import { viewerCss } from "./style.js";
import { ViewerError, unzip, type ReadEntry } from "./zip.js";

const OPF = "http://www.idpf.org/2007/opf";
const DC = "http://purl.org/dc/elements/1.1/";
const OCF = "urn:oasis:names:tc:opendocument:xmlns:container";
const EPUB = "http://www.idpf.org/2007/ops";

export interface TocEntry {
  label: string;
  /** In-document anchor, e.g. "#d2-specs"; pass it to goTo(). */
  href: string;
  depth: number;
}

export interface LoadDetail {
  title: string;
  language: string;
  toc: TocEntry[];
  chapters: number;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Parse XML with the spec's DTD rules (5.1); null if not acceptable or not well-formed. */
function parse(bytes: Uint8Array | null, html: boolean): Document | null {
  if (!bytes) return null;
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return null;
  }
  if (/<!ENTITY/i.test(text)) return null;
  for (const m of text.matchAll(/<!DOCTYPE/gi)) {
    if (!html || !/^<!DOCTYPE[ \t\r\n]+html[ \t\r\n]*>/i.test(text.slice(m.index))) return null;
  }
  const doc = new DOMParser().parseFromString(
    text,
    html ? "application/xhtml+xml" : "application/xml",
  );
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

const dom: Source<Node> = {
  type: (n) => (n.nodeType === 4 ? 3 : n.nodeType),
  ns: (n) => (n as Element).namespaceURI ?? "",
  local: (n) => (n as Element).localName,
  attrs: (n) =>
    [...(n as Element).attributes].map((a) => [a.namespaceURI ?? "", a.localName, a.value]),
  kids: (n) => [...n.childNodes],
  text: (n) => n.nodeValue ?? "",
};

const domSink: Sink<Node> = {
  element: (name, math) =>
    math ? document.createElementNS(MATHML, name) : document.createElement(name),
  text: (value) => document.createTextNode(value),
  attr: (node, name, value) => (node as Element).setAttribute(name, value),
  append: (parent, child) => parent.appendChild(child),
};

const byTag = (root: ParentNode, ns: string, local: string) => [
  ...(root as Document).getElementsByTagNameNS(ns, local),
];
const text = (el: Element | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
// In Node (SSR) there is no HTMLElement; a stand-in base class keeps `import` side-effect free.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

export class FlexovaViewer extends Base {
  static observedAttributes = ["src"];
  #urls: string[] = [];
  #detail: LoadDetail | null = null;
  #generation = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.addEventListener("click", (e) => {
      const a = (e.target as Element).closest?.("a[href^='#']");
      if (!a) return;
      e.preventDefault();
      this.goTo(a.getAttribute("href") as string);
    });
  }

  /** Metadata and table of contents of the loaded document, or null. */
  get info(): LoadDetail | null {
    return this.#detail;
  }

  get toc(): TocEntry[] {
    return this.#detail?.toc ?? [];
  }

  attributeChangedCallback(_name: string, _old: string | null, src: string | null): void {
    if (!src) return;
    fetch(src)
      .then((r) => {
        if (!r.ok)
          throw new ViewerError("LOAD_FAILED", `Could not load the document (HTTP ${r.status}).`);
        return r.arrayBuffer();
      })
      .then(
        (b) => this.load(b),
        (e) => this.#fail(e),
      );
  }

  disconnectedCallback(): void {
    this.#revoke();
  }

  /** Scroll to an in-document anchor such as "#d2-specs" (from toc or rendered links). */
  goTo(href: string): void {
    const target = this.shadowRoot?.getElementById(href.replace(/^#/, ""));
    target?.scrollIntoView({ block: "start" });
  }

  /** Display a package. Never throws: problems are shown in place and reported as a flexova-error event. */
  async load(input: ArrayBuffer | Uint8Array | Blob): Promise<void> {
    const generation = ++this.#generation;
    try {
      const bytes =
        input instanceof Blob
          ? new Uint8Array(await input.arrayBuffer())
          : input instanceof Uint8Array
            ? input
            : new Uint8Array(input);
      const read = unzip(bytes);
      const view = await this.#build(read);
      if (generation !== this.#generation) return; // a newer load() won
      this.#revoke();
      this.#urls = view.urls;
      this.shadowRoot?.replaceChildren(...view.nodes);
      this.#detail = view.detail;
      this.dispatchEvent(new CustomEvent<LoadDetail>("flexova-load", { detail: view.detail }));
    } catch (e) {
      if (generation === this.#generation) this.#fail(e);
    }
  }

  async #build(read: ReadEntry): Promise<{ nodes: Node[]; urls: string[]; detail: LoadDetail }> {
    const invalid = () =>
      new ViewerError("NOT_A_PACKAGE", "This file is not a valid Flexova package.");
    const container = parse(await read("META-INF/container.xml"), false);
    const rootfile = container && byTag(container, OCF, "rootfile")[0];
    const opfPath = rootfile?.getAttribute("full-path");
    const opf = opfPath ? parse(await read(opfPath), false) : null;
    if (!opfPath || !opf) throw invalid();

    const manifestBytes = await read("META-INF/flexova.json");
    let manifest: Record<string, unknown>;
    try {
      manifest = manifestBytes ? JSON.parse(decoder.decode(manifestBytes)) : {};
    } catch {
      manifest = {}; // best effort (spec 9.6): render with default styling
    }
    const version = typeof manifest.flexova === "string" ? manifest.flexova : "1.0";
    if (version.split(".")[0] !== "1")
      throw new ViewerError("UNSUPPORTED_VERSION", "This document needs a newer Flexova viewer.");
    if (manifest.level !== undefined && manifest.level !== "L0") {
      throw new ViewerError("SEALED", "This document is sealed. Open it in FlexPad to unlock it.");
    }

    const opfDir = parentDir(opfPath);
    const items = new Map<string, { path: string; type: string; props: string[] }>();
    for (const item of byTag(opf, OPF, "item")) {
      const path = resolve(opfDir, item.getAttribute("href") ?? "");
      if (path)
        items.set(item.getAttribute("id") ?? "", {
          path,
          type: item.getAttribute("media-type") ?? "",
          props: (item.getAttribute("properties") ?? "").split(/\s+/),
        });
    }
    const spine = byTag(opf, OPF, "itemref")
      .map((ref) => items.get(ref.getAttribute("idref") ?? ""))
      .filter((it) => it?.type === "application/xhtml+xml")
      .map((it) => (it as { path: string }).path);
    if (!spine.length) throw invalid();
    const title = text(byTag(opf, DC, "title")[0]);
    const language = text(byTag(opf, DC, "language")[0]);

    const urls: string[] = [];
    const assets = new Map<string, { url: string; kind: string }>();
    for (const it of items.values()) {
      const kind = MEDIA_KINDS[it.type];
      if (kind !== "image" && kind !== "audio") continue;
      const data = await read(it.path);
      if (!data) continue;
      const url = URL.createObjectURL(
        new Blob([data as Uint8Array<ArrayBuffer>], { type: it.type }),
      );
      urls.push(url);
      assets.set(it.path, { url, kind });
    }

    const anchors = new Map(spine.map((path, i) => [path, `d${i + 1}`]));
    const ctx = (doc: string): RenderContext => ({
      doc,
      anchors,
      asset: (path, kinds) => {
        const a = assets.get(path);
        return a && kinds.includes(a.kind) ? a.url : null;
      },
      external: { target: "_blank", rel: "noopener noreferrer" },
    });

    const style = document.createElement("style");
    style.textContent = viewerCss(manifest.tokens);
    const article = document.createElement("article");
    article.className = "fx";
    article.setAttribute("part", "document");
    if (language) article.setAttribute("lang", language);
    for (const [i, path] of spine.entries()) {
      const section = document.createElement("div");
      section.className = "fx-doc";
      section.id = `d${i + 1}`;
      const doc = parse(await read(path), true);
      const html = doc?.documentElement;
      const body = doc && html?.namespaceURI === XHTML ? byTag(doc, XHTML, "body")[0] : undefined;
      if (body) {
        const lang = html?.getAttribute("lang");
        const dir = html?.getAttribute("dir");
        if (lang) section.setAttribute("lang", lang);
        if (dir === "rtl" || dir === "ltr") section.setAttribute("dir", dir);
        rebuild(dom, domSink, body, section, ctx(path));
      } else {
        const p = document.createElement("p");
        p.className = "fx-error";
        p.textContent = "This part of the document could not be displayed.";
        section.append(p);
      }
      article.append(section);
    }

    const toc: TocEntry[] = [];
    const nav = [...items.values()].find((it) => it.props.includes("nav"));
    const navDoc = nav ? parse(await read(nav.path), true) : null;
    const tocNav =
      navDoc &&
      byTag(navDoc, XHTML, "nav").find((n) =>
        (n.getAttributeNS(EPUB, "type") ?? "").split(/\s+/).includes("toc"),
      );
    if (nav && tocNav) {
      for (const a of byTag(tocNav, XHTML, "a")) {
        const link = rewriteLink(a.getAttribute("href") ?? "", ctx(nav.path));
        let depth = 0;
        for (let p = a.parentElement; p && p !== tocNav; p = p.parentElement)
          if (p.localName === "ol") depth++;
        if (link && !link.external)
          toc.push({ label: text(a), href: link.href, depth: Math.max(0, depth - 1) });
      }
    }
    return {
      nodes: [style, article],
      urls,
      detail: { title, language, toc, chapters: spine.length },
    };
  }

  #fail(e: unknown): void {
    const err =
      e instanceof ViewerError
        ? e
        : new ViewerError("NOT_A_PACKAGE", "This file is not a valid Flexova package.");
    const style = document.createElement("style");
    style.textContent = viewerCss(undefined);
    const p = document.createElement("p");
    p.className = "fx fx-error";
    p.setAttribute("role", "alert");
    p.textContent = err.message;
    this.#revoke();
    this.#detail = null;
    this.shadowRoot?.replaceChildren(style, p);
    this.dispatchEvent(
      new CustomEvent("flexova-error", { detail: { code: err.code, message: err.message } }),
    );
  }

  #revoke(): void {
    this.#urls.forEach((u) => URL.revokeObjectURL(u));
    this.#urls = [];
  }
}
