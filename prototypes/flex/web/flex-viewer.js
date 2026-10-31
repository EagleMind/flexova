// <flex-viewer> — zero-dependency, framework-agnostic Flex viewer (Web Component + Shadow DOM).
// Works in React/Vue/Angular/Svelte/plain HTML and inside native WebViews; makes no network requests of its own.
(() => {
  const LIMITS = { entries: 10_000, totalBytes: 512 * 2 ** 20, ratio: 200 };
  const td = new TextDecoder();

  async function unzip(buf) {                                      // minimal ZIP reader: central directory + inflate
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a Flex/ZIP file");
    const count = dv.getUint16(eocd + 10, true);
    if (count > LIMITS.entries) throw new Error("too many entries");
    const entries = new Map(); let p = dv.getUint32(eocd + 16, true), total = 0;
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("corrupt central directory");
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      if (name.startsWith("/") || name.split("/").includes("..")) throw new Error("unsafe path: " + name);
      total += usize;
      if (total > LIMITS.totalBytes || (csize > 0 && usize / csize > LIMITS.ratio)) throw new Error("zip-bomb guard tripped");
      entries.set(name, { method, csize, usize, off: dv.getUint32(p + 42, true) });
      p += 46 + nlen + xlen + clen;
    }
    return async (name) => {
      const e = entries.get(name); if (!e) return null;
      const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method !== 8) throw new Error("unsupported compression");
      const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
      const out = new Uint8Array(e.usize); let o = 0;               // bounded: never grows past the declared size
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        if (o + value.length > e.usize) { reader.cancel(); throw new Error("entry larger than declared"); }
        out.set(value, o); o += value.length; }
      if (o !== e.usize) throw new Error("size mismatch");
      return out;
    };
  }

  const parseXml = (bytes, type) => {
    const text = td.decode(bytes);
    if (/<!DOCTYPE[^>]*\[|<!ENTITY/i.test(text)) throw new Error("DTD subsets are not allowed");   // XML-bomb guard
    const doc = new DOMParser().parseFromString(text, type);
    if (doc.querySelector("parsererror")) throw new Error("malformed XML");
    return doc;
  };
  const resolve = (base, rel) => new URL(rel, "flex:/" + base).pathname.slice(1);

  // Content profile allowlist: element -> permitted attributes. Unknown elements are unwrapped (children kept).
  const A = ["id"], PROFILE = { section: A, h1: A, h2: A, h3: A, h4: A, h5: A, h6: A, p: A, strong: [], em: [], b: [], i: [], code: [],
    pre: A, a: ["href", "id"], ul: A, ol: A, li: A, blockquote: A, figure: A, figcaption: [], img: ["src", "alt", "width", "height"],
    table: A, caption: [], thead: [], tbody: [], tr: [], th: ["scope", "colspan", "rowspan"], td: ["colspan", "rowspan"],
    aside: ["id", "role", "data-flex-variant"], div: ["class", "role", "aria-label", "tabindex"], details: A, summary: [],
    abbr: ["title"], dfn: A, sub: [], sup: [], br: [], hr: [], span: ["lang", "dir"] };
  const DROP = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "template", "svg", "math"]);

  function rebuild(src, chapterPath, assetUrl) {
    if (src.nodeType === 3) return document.createTextNode(src.data);
    if (src.nodeType !== 1 || DROP.has(src.localName)) return null;
    const allowed = PROFILE[src.localName];
    const out = allowed ? document.createElement(src.localName) : document.createDocumentFragment();
    if (allowed) for (const name of allowed) {
      const v = src.getAttribute(name); if (v === null) continue;
      if (name === "href") {
        if (/^(https:|mailto:)/i.test(v)) { out.href = v; out.target = "_blank"; out.rel = "noopener noreferrer"; }
        else if (!/^[a-z][a-z0-9+.-]*:/i.test(v) && v.includes("#")) out.setAttribute("href", "#" + v.split("#")[1]);
        continue;                                                  // javascript:, data:, file: … silently dropped
      }
      if (name === "src") { const u = assetUrl(resolve(chapterPath, v)); if (u) out.src = u; continue; }
      if (name === "class" && v !== "flex-table") continue;
      out.setAttribute(name, v);
    }
    for (const c of src.childNodes) { const r = rebuild(c, chapterPath, assetUrl); if (r) out.append(r); }
    return out;
  }

  const COLOR = /^#[0-9a-f]{3,8}$/i;                               // tokens are data, never raw CSS
  function tokenCss(tokens = {}) {
    const vars = (mode) => Object.entries(tokens.color || {}).filter(([k, v]) => /^[a-z-]+$/.test(k) && COLOR.test(v?.[mode] || ""))
      .map(([k, v]) => `--flex-${k}:${v[mode]};`).join("");
    return `:host{all:initial;display:block;color-scheme:light dark;--flex-fg:#1a1a1a;--flex-bg:#fff;--flex-accent:#0b5fff;--flex-warning-bg:#fff4e5;${vars("light")}}
@media (prefers-color-scheme:dark){:host(:not([theme=light])){--flex-fg:#e8e6e3;--flex-bg:#121212;--flex-accent:#7aa7ff;--flex-warning-bg:#3a2a12;${vars("dark")}}}
:host([theme=dark]){--flex-fg:#e8e6e3;--flex-bg:#121212;--flex-accent:#7aa7ff;--flex-warning-bg:#3a2a12;${vars("dark")}}
.doc{background:var(--flex-bg);color:var(--flex-fg);font:1.0625rem/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  max-width:68ch;margin-inline:auto;padding:1rem;overflow-wrap:break-word}
a{color:var(--flex-accent)} img{max-width:100%;height:auto} figure{margin-inline:0}
.flex-table{overflow-x:auto} table{border-collapse:collapse} th,td{padding:.4em .6em;text-align:start;border-bottom:1px solid color-mix(in srgb,var(--flex-fg) 15%,transparent)}
aside[role=note]{background:var(--flex-warning-bg);padding:.5em 1em;border-radius:6px} pre{overflow-x:auto}`;
  }

  class FlexViewer extends HTMLElement {
    static observedAttributes = ["src"];
    #urls = [];
    constructor() { super(); this.attachShadow({ mode: "open" }); }
    attributeChangedCallback(_, __, src) { if (src) fetch(src).then((r) => r.arrayBuffer()).then((b) => this.load(b)).catch((e) => this.#fail(e)); }
    disconnectedCallback() { this.#urls.forEach(URL.revokeObjectURL); }
    #fail(e) { this.shadowRoot.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Cannot open document: " + e.message }));
      this.dispatchEvent(new CustomEvent("flex-error", { detail: e.message })); }

    async load(input) {                                            // ArrayBuffer | Blob | File
      try {
        const read = await unzip(input instanceof ArrayBuffer ? input : await input.arrayBuffer());
        const need = async (p) => { const b = await read(p); if (!b) throw new Error("missing " + p); return b; };
        const opfPath = parseXml(await need("META-INF/container.xml"), "application/xml").querySelector("rootfile").getAttribute("full-path");
        const opf = parseXml(await need(opfPath), "application/xml");
        const manifest = new Map([...opf.querySelectorAll("manifest > item")].map((i) => [i.getAttribute("id"),
          { path: resolve(opfPath, i.getAttribute("href")), type: i.getAttribute("media-type") }]));
        const types = new Map([...manifest.values()].map((m) => [m.path, m.type]));
        const profile = JSON.parse(td.decode((await read("META-INF/flex.json")) || new TextEncoder().encode("{}")));
        if (profile.level && profile.level !== "L0") throw new Error("this document is sealed; open it in FlexPad");
        const blobs = new Map();
        for (const [path, type] of types) if (/^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/.test(type)) {
          const u = URL.createObjectURL(new Blob([await need(path)], { type })); blobs.set(path, u); this.#urls.push(u); }
        const doc = Object.assign(document.createElement("article"), { className: "doc" });
        for (const ref of opf.querySelectorAll("spine > itemref")) {
          const item = manifest.get(ref.getAttribute("idref"));
          const body = parseXml(await need(item.path), "application/xhtml+xml").querySelector("body");
          for (const c of body.childNodes) { const r = rebuild(c, item.path, (p) => blobs.get(p)); if (r) doc.append(r); }
        }
        doc.addEventListener("click", (e) => { const a = e.target.closest("a[href^='#']"); if (!a) return;
          e.preventDefault(); this.shadowRoot.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth" }); });
        const style = document.createElement("style"); style.textContent = tokenCss(profile.tokens);
        this.shadowRoot.replaceChildren(style, doc);
        const title = opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "title")[0]?.textContent ?? "";
        this.dispatchEvent(new CustomEvent("flex-load", { detail: { title } }));
      } catch (e) { this.#fail(e); }
    }
  }
  customElements.define("flex-viewer", FlexViewer);
})();
