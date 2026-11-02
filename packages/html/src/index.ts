// @flexova/html: render a Flexova package as one self-contained, static .flexova.html file (ADR-0006).
// The page needs no JavaScript, cannot load anything from the network (CSP), and embeds every entry of the
// original package so a trusted reader can extract it again byte for byte (fromHtml).
import {
  compileTokens,
  pack,
  parseXml,
  read,
  sha256,
  unpack,
  type XmlElement,
} from "@flexova/core";
import {
  MEDIA_KINDS,
  XHTML,
  rebuild,
  type RenderContext,
  type Sink,
  type Source,
} from "@flexova/viewer/render";

export interface ToHtmlOptions {
  /** Warn above this many bytes of HTML (default 30 MB, the soft cap of ADR-0006). */
  softLimitBytes?: number;
}

export interface ToHtmlResult {
  html: string;
  warnings: string[];
}

const PACKAGE_SCRIPT_TYPE = "application/vnd.flexova.package+json";
const VOID = new Set(["img", "br", "hr", "source"]);
const RENDITION_CSS =
  // Off-screen chapters skip layout until scrolled near, which keeps very long documents fast.
  "main>.fx-doc{content-visibility:auto;contain-intrinsic-size:auto 1500px}" +
  "main>.fx-doc+.fx-doc{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--flexova-surface)}" +
  ".fx-scroll{overflow-x:auto;max-width:100%}math[display=block]{overflow-x:auto;max-width:100%}" +
  "audio{max-width:100%}:target{scroll-margin-top:1rem}\n";

const escapeText = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

type X = XmlElement | string;
const xmlSource: Source<X> = {
  type: (n) => (typeof n === "string" ? 3 : 1),
  ns: (n) => (n as XmlElement).ns,
  local: (n) => (n as XmlElement).local,
  attrs: (n) => (n as XmlElement).attrs.map((a) => [a.ns, a.local, a.value]),
  kids: (n) => (typeof n === "string" ? [] : n.children),
  text: (n) => n as string,
};

interface El {
  name: string;
  attrs: [string, string][];
  kids: (El | string)[];
}

function serialize(n: El | string): string {
  if (typeof n === "string") return escapeText(n);
  const attrs = n.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
  return VOID.has(n.name)
    ? `<${n.name}${attrs}>`
    : `<${n.name}${attrs}>${n.kids.map(serialize).join("")}</${n.name}>`;
}

function bodyOf(bytes: Uint8Array | undefined): { body: XmlElement; root: XmlElement } | null {
  if (!bytes) return null;
  const x = parseXml(bytes, true);
  const body = x.root?.elements().find((e) => e.ns === XHTML && e.local === "body");
  return x.root && body ? { body, root: x.root } : null;
}

/** Render a valid package as a static, self-contained HTML page. Throws FlexovaError for invalid packages. */
export async function toHtml(
  input: Uint8Array | ArrayBuffer,
  options: ToHtmlOptions = {},
): Promise<ToHtmlResult> {
  const pkg = await read(input);
  const warnings: string[] = [];

  // Embedded resources become data: URIs; elements that carry one are tagged with the package path, so the
  // original bytes can be recovered from the page without storing images twice.
  const dataUris = new Map<string, { uri: string; kind: string }>();
  const pathOfUri = new Map<string, string>();
  for (const item of pkg.items) {
    const kind = MEDIA_KINDS[item.mediaType];
    const bytes = pkg.entries.get(item.path);
    if ((kind === "image" || kind === "audio") && bytes) {
      const uri = `data:${item.mediaType};base64,${toBase64(bytes)}`;
      dataUris.set(item.path, { uri, kind });
      pathOfUri.set(uri, item.path);
    }
  }
  const tagged = new Set<string>();
  const sink: Sink<El | string> = {
    element: (name) => ({ name, attrs: [], kids: [] }),
    text: (value) => value,
    attr: (node, name, value) => {
      const el = node as El;
      el.attrs.push([name, value]);
      const path = (name === "src" || name === "srcset") && pathOfUri.get(value);
      if (path) {
        el.attrs.push(["data-flexova-src", path]);
        tagged.add(path);
      }
    },
    append: (parent, child) => (parent as El).kids.push(child),
  };

  const anchors = new Map(pkg.spine.map((path, i) => [path, `d${i + 1}`]));
  const context = (doc: string): RenderContext => ({
    doc,
    anchors,
    asset: (path, kinds) => {
      const d = dataUris.get(path);
      return d && kinds.includes(d.kind) ? d.uri : null;
    },
    external: { rel: "noopener noreferrer" },
  });
  const renderDoc = (path: string, id: string, extraClass = ""): El => {
    const section: El = {
      name: "div",
      attrs: [
        ["class", `fx-doc${extraClass}`],
        ["id", id],
      ],
      kids: [],
    };
    const doc = bodyOf(pkg.entries.get(path));
    if (!doc) return section;
    const lang = doc.root.attr("lang");
    const dir = doc.root.attr("dir");
    if (lang && lang !== pkg.language) section.attrs.push(["lang", lang]);
    if (dir === "rtl" || dir === "ltr") section.attrs.push(["dir", dir]);
    rebuild(xmlSource, sink, doc.body, section, context(path));
    return section;
  };

  const main: El = { name: "main", attrs: [], kids: [] };
  if (pkg.navPath && !anchors.has(pkg.navPath))
    main.kids.push(renderDoc(pkg.navPath, "d0", " fx-nav"));
  pkg.spine.forEach((path, i) => main.kids.push(renderDoc(path, `d${i + 1}`)));

  // Entries not recoverable from the page's data: URIs travel as one compressed ZIP (inert JSON, never executed).
  const rest = new Map([...pkg.entries].filter(([name]) => !tagged.has(name)));
  const packageJson = JSON.stringify({
    format: "flexova-html",
    version: 1,
    names: [...pkg.entries.keys()].sort(),
    zip: toBase64(pack(rest)),
  }).replace(/</g, "\\u003c");

  const css = compileTokens(pkg.tokens) + RENDITION_CSS;
  const styleHash = toBase64(await sha256(new TextEncoder().encode(css)));
  const csp = `default-src 'none'; style-src 'sha256-${styleHash}'; img-src data:; media-src data:; base-uri 'none'; form-action 'none'`;
  const firstDir = bodyOf(pkg.entries.get(pkg.spine[0] ?? ""))?.root.attr("dir");
  const html =
    "<!doctype html>\n" +
    `<html lang="${escapeAttr(pkg.language)}"${firstDir === "rtl" ? ' dir="rtl"' : ""}>\n<head>\n<meta charset="utf-8">\n` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">\n` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="color-scheme" content="light dark">\n' +
    '<meta name="generator" content="Flexova">\n' +
    `<title>${escapeText(pkg.title)}</title>\n<style>${css}</style>\n</head>\n<body>\n${serialize(main)}\n` +
    `<script type="${PACKAGE_SCRIPT_TYPE}" id="flexova-package">${packageJson}</script>\n</body>\n</html>\n`;

  const limit = options.softLimitBytes ?? 30 * 1000 * 1000;
  const size = new TextEncoder().encode(html).length;
  if (size > limit) {
    warnings.push(
      `The page is ${(size / 1e6).toFixed(1)} MB, above the ${(limit / 1e6).toFixed(0)} MB soft limit; phones may struggle. Share the .flexova package or a link instead.`,
    );
  }
  return { html, warnings };
}

/**
 * Recover the original package from a page produced by toHtml(): every entry, byte for byte, re-packed
 * deterministically. Validate the result (and its signature, if any) before trusting it.
 */
export function fromHtml(html: string): Uint8Array {
  const script = new RegExp(
    `<script type="${PACKAGE_SCRIPT_TYPE.replace(/[.+]/g, "\\$&")}" id="flexova-package">([\\s\\S]*?)</script>`,
  ).exec(html);
  if (!script) throw new Error("This page does not embed a Flexova package.");
  const data = JSON.parse(script[1] as string) as {
    format: string;
    version: number;
    names: string[];
    zip: string;
  };
  if (data.format !== "flexova-html" || data.version !== 1)
    throw new Error("Unsupported embedded package format.");
  const entries = unpack(fromBase64(data.zip));
  for (const tag of html.matchAll(/<(?:img|source|audio)\b[^>]*>/g)) {
    const attrs = Object.fromEntries(
      [...tag[0].matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    const path = attrs["data-flexova-src"];
    const uri = attrs.src ?? attrs.srcset;
    const marker = uri?.indexOf(";base64,") ?? -1;
    const b64 = uri && marker >= 0 ? uri.slice(marker + 8) : undefined;
    if (path && b64 && !entries.has(path)) entries.set(path, fromBase64(b64));
  }
  const missing = data.names.filter((n) => !entries.has(n));
  if (missing.length)
    throw new Error(`The embedded package is incomplete (missing ${missing.join(", ")}).`);
  return pack(entries);
}
