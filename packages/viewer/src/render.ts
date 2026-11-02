// Shared, environment-free rendering core (spec section 9): rebuild a content document's body from the
// profile allowlist, namespacing ids per document and rewriting links, through any "sink" (DOM in the
// viewer, an HTML string builder in @flexova/html). Nothing from the package is ever copied verbatim.
import { PROFILE as P } from "./allowlist.js";

export const XHTML = "http://www.w3.org/1999/xhtml";
export const MATHML = "http://www.w3.org/1998/Math/MathML";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const EPUB_NS = "http://www.idpf.org/2007/ops";

export const LIMITS = P.limits;
export const MEDIA_KINDS: Record<string, string> = P.mediaTypes;
const ENTRY_NAME = new RegExp(P.entryName);
const ID = new RegExp(P.idPattern);
const PATTERNS = Object.fromEntries(Object.entries(P.patterns).map(([k, v]) => [k, new RegExp(v)]));
const FORBIDDEN = new Set<string>(P.forbidden);
const FORBIDDEN_ATTRS = P.forbiddenAttributes.map((p) => new RegExp(p, "i"));
const MATH_ELEMENTS = new Set<string>(P.mathElements);
const MATH_ATTRS = new Set<string>(P.mathAttributes);
const ELEMENTS: Record<string, Record<string, string>> = P.elements;
const GLOBALS: Record<string, string> = P.globals;
const SCHEMES: readonly string[] = P.linkSchemes;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const own = <T>(o: Record<string, T>, k: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;

/** Read access to a parsed source tree (DOM nodes in browsers, XML trees in Node). */
export interface Source<S> {
  /** 1 = element, 3 = text, anything else is ignored. */
  type(node: S): number;
  ns(node: S): string;
  local(node: S): string;
  attrs(node: S): [ns: string, local: string, value: string][];
  kids(node: S): S[];
  text(node: S): string;
}

/** Where rebuilt nodes go. */
export interface Sink<N> {
  element(name: string, math: boolean): N;
  text(value: string): N;
  attr(node: N, name: string, value: string): void;
  append(parent: N, child: N): void;
}

export interface RenderContext {
  /** Package path of the document being rendered, e.g. OEBPS/content/01.xhtml. */
  doc: string;
  /** Rendered documents by package path, mapped to their anchor id (e.g. "d2"). Element ids become "d2-<id>". */
  anchors: Map<string, string>;
  /** Resolve a package path to a URL for an embedded resource of one of the given kinds, or null. */
  asset(path: string, kinds: string[]): string | null;
  /** Extra attributes for links that leave the document (e.g. target and rel). */
  external: Record<string, string>;
}

export const parentDir = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** Resolve a relative reference inside the package (same algorithm as @flexova/core). */
export function resolve(baseDir: string, ref: string): string | null {
  if (!ref || ref.startsWith("/") || /[?#%\\ \t\r\n]/.test(ref)) return null;
  const parts = baseDir ? baseDir.split("/") : [];
  for (const seg of ref.split("/")) {
    if (seg === "") return null;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (seg !== ".") parts.push(seg);
  }
  const path = parts.join("/");
  return ENTRY_NAME.test(path) ? path : null;
}

/** Rewrite a link for the rendered page: external URLs pass through; internal ones become #anchors. */
export function rewriteLink(
  value: string,
  ctx: RenderContext,
): { href: string; external: boolean } | null {
  if (SCHEME.test(value)) {
    const scheme = value.slice(0, value.indexOf(":")).toLowerCase();
    return SCHEMES.includes(scheme) ? { href: value, external: true } : null;
  }
  if (value.startsWith("//") || /[?%\\ \t\r\n]/.test(value)) return null;
  const hash = value.indexOf("#");
  const path = hash < 0 ? value : value.slice(0, hash);
  const fragment = hash < 0 ? "" : value.slice(hash + 1);
  const target = path ? resolve(parentDir(ctx.doc), path) : ctx.doc;
  const anchor = target === null ? undefined : ctx.anchors.get(target);
  if (anchor === undefined || (hash >= 0 && !fragment)) return null;
  return { href: `#${fragment ? `${anchor}-${fragment}` : anchor}`, external: false };
}

/** Rebuild the children of `parent` (e.g. a document's <body>) into `into`. */
export function rebuild<S, N>(
  src: Source<S>,
  sink: Sink<N>,
  parent: S,
  into: N,
  ctx: RenderContext,
): void {
  const anchor = ctx.anchors.get(ctx.doc) ?? "d0";
  const walk = (node: S, out: N, depth: number): void => {
    for (const kid of src.kids(node)) {
      const type = src.type(kid);
      if (type === 3) {
        sink.append(out, sink.text(src.text(kid)));
        continue;
      }
      if (type !== 1 || depth >= LIMITS.maxNestingDepth) continue;
      const ns = src.ns(kid);
      const local = src.local(kid);
      if (FORBIDDEN.has(local)) continue; // dropped with its subtree
      const math = ns === MATHML && MATH_ELEMENTS.has(local);
      const allowed = ns === XHTML ? own(ELEMENTS, local) : undefined;
      if (!math && !allowed) {
        walk(kid, out, depth + 1); // unknown element: unwrap, keep its content
        continue;
      }
      const el = sink.element(local, math);
      if (!setAttributes(kid, el, local, math, allowed)) continue;
      walk(kid, el, depth + 1);
      if (local === "table") {
        // Wide tables scroll inside their own focusable region instead of widening the page.
        const box = sink.element("div", false);
        sink.attr(box, "class", "fx-scroll");
        sink.attr(box, "role", "region");
        sink.attr(box, "tabindex", "0");
        sink.attr(box, "aria-label", captionText(kid) || "Table");
        sink.append(box, el);
        sink.append(out, box);
      } else {
        sink.append(out, el);
      }
    }
  };

  const captionText = (table: S): string => {
    const caption = src.kids(table).find((k) => src.type(k) === 1 && src.local(k) === "caption");
    if (!caption) return "";
    const parts: string[] = [];
    const collect = (n: S) =>
      src.kids(n).forEach((k) => (src.type(k) === 3 ? parts.push(src.text(k)) : collect(k)));
    collect(caption);
    return parts.join("").replace(/\s+/g, " ").trim();
  };

  /** Copy allowed attributes. Returns false if the element must be dropped (e.g. an image without a usable source). */
  const setAttributes = (
    node: S,
    el: N,
    local: string,
    math: boolean,
    allowed: Record<string, string> | undefined,
  ): boolean => {
    let hasLang = false;
    let langValue: string | null = null;
    for (const [ns, name, value] of src.attrs(node)) {
      const qname =
        ns === XML_NS ? `xml:${name}` : ns === EPUB_NS ? `epub:${name}` : ns ? null : name;
      if (qname === null || FORBIDDEN_ATTRS.some((p) => p.test(qname))) continue;
      const spec = math
        ? MATH_ATTRS.has(qname)
          ? qname === "id"
            ? "id"
            : "text"
          : undefined
        : (own(allowed ?? {}, qname) ?? own(GLOBALS, qname));
      if (spec === undefined || qname === "epub:type") continue;
      if (spec === "id") {
        if (ID.test(value)) sink.attr(el, "id", `${anchor}-${value}`);
      } else if (spec === "text") {
        sink.attr(el, qname, value);
      } else if (spec === "boolean") {
        if (value === "" || value === qname) sink.attr(el, qname, "");
      } else if (spec.startsWith("enum:")) {
        if (spec.slice(5).split("|").includes(value)) sink.attr(el, qname, value);
      } else if (spec.startsWith("re:")) {
        const pattern = PATTERNS[spec.slice(3)];
        if (!pattern || !pattern.test(value)) continue;
        if (qname === "xml:lang") langValue ??= value;
        else {
          if (qname === "lang") hasLang = true;
          sink.attr(el, qname, value);
        }
      } else if (spec.startsWith("uri:")) {
        const target =
          SCHEME.test(value) || value.startsWith("//") ? null : resolve(parentDir(ctx.doc), value);
        const url = target === null ? null : ctx.asset(target, spec.slice(4).split(","));
        if (url !== null) sink.attr(el, qname, url);
        else if (local === "img" || local === "source" || local === "audio") return false;
      } else if (spec === "link") {
        const link = rewriteLink(value, ctx);
        if (link) {
          sink.attr(el, "href", link.href);
          if (link.external) for (const [k, v] of Object.entries(ctx.external)) sink.attr(el, k, v);
        }
      }
    }
    if (!hasLang && langValue !== null) sink.attr(el, "lang", langValue);
    if (
      (local === "img" || local === "audio") &&
      !src.attrs(node).some(([ns, n]) => !ns && n === "src")
    )
      return false;
    return true;
  };

  walk(parent, into, 0);
}
