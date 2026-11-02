// validate(): the four validation phases of spec/flexova-1.0.md section 8 (zip, package, manifest, resources).
import { ContentValidator } from "./content.js";
import { sha256Hex } from "./hash.js";
import { parentDir, resolve } from "./paths.js";
import { Collector, type Report } from "./report.js";
import {
  CONSTANTS,
  CONTAINER_NS,
  DC_NS,
  MEDIA_TYPES,
  NS,
  OPF_NS,
  PROFILE,
  XHTML_TYPE,
  own,
} from "./spec.js";
import { checkTokens, isInteger } from "./tokens.js";
import { XmlElement, decodeUtf8, parseXml, splitWs, xmlTrim } from "./xml.js";
import { readZip } from "./zip.js";

const MANIFEST_PATH = CONSTANTS.manifestPath as string;
const SIGNATURE_PATH = "META-INF/flexova.sig.jws";
const UNLISTED = new Set(["mimetype", MANIFEST_PATH, SIGNATURE_PATH]);
const LANG = new RegExp((PROFILE.attributeTypes.lang as { pattern: string }).pattern);
const MODIFIED = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const VERSION = /^[0-9]+\.[0-9]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const A11Y_PROPERTIES = [
  "schema:accessMode",
  "schema:accessModeSufficient",
  "schema:accessibilityFeature",
  "schema:accessibilityHazard",
  "schema:accessibilitySummary",
];
const WS = "[ \\t\\r\\n\\f]";
const CSS_UNSAFE = [
  /@import/i,
  new RegExp(`url\\(${WS}*["']?${WS}*([a-z][a-z0-9+.-]*:|//)`, "i"),
  new RegExp(`expression${WS}*\\(`, "i"),
  new RegExp(`behavior${WS}*:`, "i"),
  /-moz-binding/i,
  /javascript:/i,
];
const SVG_UNSAFE_ELEMENTS = new Set(["script", "foreignobject", "iframe", "handler", "listener"]);
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((ch) => ch.charCodeAt(0));
const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  "image/gif": (b) => startsWith(b, ascii("GIF87a")) || startsWith(b, ascii("GIF89a")),
  "image/webp": (b) =>
    b.length >= 12 && startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8),
};
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface Item {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
  supported: boolean;
  exists: boolean;
}

export interface Package {
  opfPath: string;
  title: string;
  language: string;
  identifier: string;
  modified: string;
  authors: string[];
  items: Item[]; // document order
  byPath: Map<string, Item>;
  navPath: string | null;
  spine: string[];
}

const children = (el: XmlElement | null, ns: string, local: string) =>
  el ? el.elements().filter((e) => e.ns === ns && e.local === local) : [];
const first = (el: XmlElement | null, ns: string, local: string) =>
  children(el, ns, local)[0] ?? null;

function parsePrefix(value: string): Record<string, string> {
  const tokens = splitWs(value);
  const mapping: Record<string, string> = {};
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] as string;
    if (t.endsWith(":") && i + 1 < tokens.length) {
      mapping[t.slice(0, -1)] = tokens[i + 1] as string;
      i += 2;
    } else {
      i += 1;
    }
  }
  return mapping;
}

// --- phase 2: package -------------------------------------------------------------------------
export function checkPackage(entries: Map<string, Uint8Array>, c: Collector): Package | null {
  const containerPath = "META-INF/container.xml";
  const container = entries.get(containerPath);
  if (!container) {
    c.add("OCF_CONTAINER_MISSING", containerPath);
    return null;
  }
  const cx = parseXml(container, false);
  if (cx.error !== null) {
    c.add(cx.error, containerPath);
    return null;
  }
  let opfPath: string | null = null;
  if (cx.root.ns === CONTAINER_NS && cx.root.local === "container") {
    const rootfile = [...cx.root.iter()].find(
      (e) => e.ns === CONTAINER_NS && e.local === "rootfile",
    );
    if (rootfile && rootfile.attr("media-type") === "application/oebps-package+xml")
      opfPath = rootfile.attr("full-path");
  }
  if (!opfPath || !entries.has(opfPath)) {
    c.add("OCF_ROOTFILE_MISSING", containerPath);
    return null;
  }
  const ox = parseXml(entries.get(opfPath) as Uint8Array, false);
  if (ox.error !== null) {
    c.add(ox.error, opfPath);
    return null;
  }
  const root = ox.root;
  if (!(root.ns === OPF_NS && root.local === "package" && root.attr("version") === "3.0")) {
    c.add("OPF_INVALID", opfPath, 'root must be <package version="3.0">');
    return null;
  }

  // metadata
  const metadata = first(root, OPF_NS, "metadata");
  const metas = new Map<string, string[]>();
  for (const m of children(metadata, OPF_NS, "meta")) {
    const prop = m.attr("property");
    const text = xmlTrim(m.text());
    if (prop !== null && text) metas.set(prop, [...(metas.get(prop) ?? []), text]);
  }
  const uid = root.attr("unique-identifier");
  const missing: string[] = [];
  if (
    !children(metadata, DC_NS, "identifier").some((e) => e.attr("id") === uid && xmlTrim(e.text()))
  ) {
    missing.push("dc:identifier");
  }
  if (!children(metadata, DC_NS, "title").some((e) => xmlTrim(e.text()))) missing.push("dc:title");
  const langs = children(metadata, DC_NS, "language")
    .map((e) => xmlTrim(e.text()))
    .filter(Boolean);
  if (!langs.length) missing.push("dc:language");
  const modified = metas.get("dcterms:modified") ?? [];
  if (!modified.length) missing.push("dcterms:modified");
  if (missing.length) c.add("OPF_MISSING_METADATA", opfPath, missing.join(", "));
  const invalid: string[] = [];
  if (langs.length && !LANG.test(langs[0] as string)) invalid.push("dc:language");
  if (modified.length && !MODIFIED.test(modified[0] as string)) invalid.push("dcterms:modified");
  if (invalid.length) c.add("OPF_INVALID_METADATA", opfPath, invalid.join(", "));
  const profile = metas.get("flexova:profile") ?? [];
  if (
    own(parsePrefix(root.attr("prefix") ?? ""), "flexova") !== CONSTANTS.namespaceUri ||
    !profile.length
  ) {
    c.add("OPF_PROFILE_MISSING", opfPath);
  } else if (!/^1\.[0-9]+$/.test(profile[0] as string)) {
    c.add("OPF_PROFILE_UNSUPPORTED", opfPath, profile[0]);
  }
  if (!A11Y_PROPERTIES.every((p) => metas.has(p))) c.add("OPF_A11Y_METADATA_MISSING", opfPath);

  // manifest items
  const manifest = first(root, OPF_NS, "manifest");
  const opfDir = parentDir(opfPath);
  const items: Item[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  let problem: string | null = manifest ? null : "no <manifest>";
  for (const e of children(manifest, OPF_NS, "item")) {
    const id = e.attr("id");
    const href = e.attr("href");
    const mediaType = e.attr("media-type");
    const path = href ? resolve(opfDir, href) : null;
    if (!id || !mediaType || path === null)
      problem = "an <item> lacks id, media-type or a valid local href";
    else if (ids.has(id) || paths.has(path)) problem = `duplicate item ${id} / ${path}`;
    if (problem) break;
    ids.add(id as string);
    paths.add(path as string);
    items.push({
      id: id as string,
      path: path as string,
      mediaType: mediaType as string,
      properties: splitWs(e.attr("properties") ?? ""),
      supported: own(MEDIA_TYPES, mediaType as string) !== undefined,
      exists: true,
    });
  }
  if (problem) {
    c.add("OPF_INVALID", opfPath, problem);
    return null;
  }
  const pkg: Package = {
    opfPath,
    title:
      children(metadata, DC_NS, "title")
        .map((e) => xmlTrim(e.text()))
        .find(Boolean) ?? "",
    language: langs[0] ?? "",
    identifier:
      children(metadata, DC_NS, "identifier")
        .filter((e) => e.attr("id") === uid)
        .map((e) => xmlTrim(e.text()))
        .find(Boolean) ?? "",
    modified: modified[0] ?? "",
    authors: children(metadata, DC_NS, "creator")
      .map((e) => xmlTrim(e.text()))
      .filter(Boolean),
    items,
    byPath: new Map(items.map((i) => [i.path, i])),
    navPath: null,
    spine: [],
  };
  for (const it of [...items].sort((a, b) => byCodePoint(a.path, b.path))) {
    if (!it.supported) c.add("OPF_UNSUPPORTED_MEDIA_TYPE", it.path, it.mediaType);
    if (!entries.has(it.path)) {
      c.add("OPF_MISSING_RESOURCE", it.path);
      it.exists = false;
    }
  }
  for (const name of [...entries.keys()].sort(byCodePoint)) {
    if (
      name !== "mimetype" &&
      !name.startsWith("META-INF/") &&
      name !== opfPath &&
      !pkg.byPath.has(name)
    ) {
      c.add("OPF_UNDECLARED_RESOURCE", name);
    }
  }
  const nav = items.find((it) => it.properties.includes("nav"));
  if (!nav || nav.mediaType !== XHTML_TYPE) c.add("OPF_NAV_MISSING", opfPath);
  else pkg.navPath = nav.path;

  const refs = children(first(root, OPF_NS, "spine"), OPF_NS, "itemref");
  if (!refs.length) c.add("OPF_SPINE_INVALID", opfPath, "empty spine");
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const ref of refs) {
    const it = byId.get(ref.attr("idref") ?? "");
    if (!it || it.mediaType !== XHTML_TYPE)
      c.add("OPF_SPINE_INVALID", opfPath, `itemref ${JSON.stringify(ref.attr("idref"))}`);
    else pkg.spine.push(it.path);
  }
  return pkg;
}

// --- phase 3: manifest ------------------------------------------------------------------------
type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const hasOwn = (o: Record<string, Json>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Nesting depth of containers (a top-level object is depth 1), computed iteratively. */
export function jsonDepth(value: Json): number {
  let deepest = 0;
  const stack: [Json, number][] = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop() as [Json, number];
    if (typeof node !== "object" || node === null) continue;
    deepest = Math.max(deepest, depth);
    for (const child of Array.isArray(node) ? node : Object.values(node))
      stack.push([child, depth + 1]);
  }
  return deepest;
}

async function checkManifest(entries: Map<string, Uint8Array>, c: Collector): Promise<void> {
  const raw = entries.get(MANIFEST_PATH);
  if (!raw) return c.add("MAN_MISSING", MANIFEST_PATH);
  let doc: Json;
  try {
    doc = JSON.parse(strictUtf8.decode(raw));
  } catch {
    return c.add("MAN_INVALID", MANIFEST_PATH, "not valid UTF-8 JSON");
  }
  if (jsonDepth(doc) > PROFILE.limits.maxManifestDepth)
    return c.add("MAN_INVALID", MANIFEST_PATH, "nested too deeply");
  if (!isObject(doc)) return c.add("MAN_INVALID", MANIFEST_PATH, "must be a JSON object");
  const version = doc.flexova;
  if (typeof version !== "string" || !hasOwn(doc, "flexova") || !VERSION.test(version)) {
    return c.add("MAN_INVALID", MANIFEST_PATH, "flexova must be a MAJOR.MINOR string");
  }
  if (version.split(".")[0] !== "1")
    return c.add("MAN_UNSUPPORTED_VERSION", MANIFEST_PATH, version);
  const level = hasOwn(doc, "level") ? doc.level : undefined;
  if (typeof level !== "string" || !["L0", "L1", "L2"].includes(level)) {
    return c.add("MAN_INVALID", MANIFEST_PATH, "level must be L0, L1 or L2");
  }
  if (level !== "L0") return c.add("MAN_UNSUPPORTED_LEVEL", MANIFEST_PATH, level);
  if (hasOwn(doc, "tokens")) checkTokens(doc.tokens, c, MANIFEST_PATH);

  const listed = hasOwn(doc, "entries") ? doc.entries : undefined;
  if (!Array.isArray(listed))
    return c.add("MAN_INVALID", MANIFEST_PATH, "entries must be an array");
  const seen = new Map<string, { size: number; sha256: string }>();
  for (const e of listed as Json[]) {
    const ok =
      isObject(e) &&
      typeof e.path === "string" &&
      e.path !== "" &&
      !UNLISTED.has(e.path) &&
      !seen.has(e.path) &&
      isInteger(e.size) &&
      e.size >= 0 &&
      typeof e.sha256 === "string" &&
      SHA256.test(e.sha256);
    if (!ok) return c.add("MAN_INVALID", MANIFEST_PATH, "malformed or duplicate entry");
    seen.set(e.path as string, { size: e.size as number, sha256: e.sha256 as string });
  }
  for (const path of [...seen.keys()].sort(byCodePoint)) {
    const want = seen.get(path) as { size: number; sha256: string };
    const data = entries.get(path);
    if (!data || data.length !== want.size || (await sha256Hex(data)) !== want.sha256)
      c.add("MAN_HASH_MISMATCH", path);
  }
  const omitted = [...entries.keys()]
    .filter((n) => !UNLISTED.has(n) && !seen.has(n))
    .sort(byCodePoint);
  if (omitted.length)
    c.add("MAN_ENTRIES_INCOMPLETE", MANIFEST_PATH, omitted.slice(0, 5).join(", "));
}

// --- phase 4: resources -----------------------------------------------------------------------
export const cssUnsafe = (text: string): boolean => CSS_UNSAFE.some((p) => p.test(text));

function checkSvg(path: string, data: Uint8Array, c: Collector): void {
  const x = parseXml(data, false);
  if (x.error !== null) return c.add(x.error, path);
  if (!(x.root.ns === NS.svg && x.root.local === "svg")) return c.add("XML_WRONG_NAMESPACE", path);
  for (const el of x.root.iter()) {
    let unsafe =
      SVG_UNSAFE_ELEMENTS.has(el.local.toLowerCase()) ||
      (el.local === "style" && cssUnsafe(el.text()));
    for (const { local, value } of el.attrs) {
      const name = local.toLowerCase();
      if (
        name.startsWith("on") ||
        (name === "href" && !value.startsWith("#")) ||
        (name === "style" && cssUnsafe(value))
      ) {
        unsafe = true;
      }
    }
    if (unsafe) return c.add("ASSET_SVG_UNSAFE", path);
  }
}

function checkResources(entries: Map<string, Uint8Array>, pkg: Package, c: Collector): void {
  const docs = new Map<string, ContentValidator>();
  for (const it of [...pkg.items].sort((a, b) => byCodePoint(a.path, b.path))) {
    if (!it.supported || !it.exists) continue;
    const data = entries.get(it.path) as Uint8Array;
    const kind = MEDIA_TYPES[it.mediaType];
    if (kind === "content") {
      const x = parseXml(data, true);
      if (x.error !== null) {
        c.add(x.error, it.path);
        continue;
      }
      if (!(x.root.ns === NS.xhtml && x.root.local === "html")) {
        c.add("XML_WRONG_NAMESPACE", it.path);
        continue;
      }
      const v = new ContentValidator(it.path, pkg, c);
      v.run(x.root);
      docs.set(it.path, v);
    } else if (kind === "style") {
      const text = decodeUtf8(data);
      if (text === null || cssUnsafe(text)) c.add("CSS_UNSAFE", it.path);
    } else if (it.mediaType === "image/svg+xml") {
      checkSvg(it.path, data, c);
    } else {
      const magic = own(MAGIC, it.mediaType);
      if (magic && !magic(data)) c.add("ASSET_TYPE_MISMATCH", it.path, it.mediaType);
    }
  }
  const nav = pkg.navPath ? docs.get(pkg.navPath) : undefined;
  if (nav && !nav.hasToc) c.add("OPF_NAV_INVALID", pkg.navPath as string);
  for (const [path, v] of docs) {
    for (const fragment of v.sameDocFragments) {
      if (!v.ids.has(fragment)) c.add("PRF_BROKEN_LINK", path, `#${fragment}`);
    }
    for (const [target, fragment] of v.crossDocLinks) {
      const t = docs.get(target);
      if (t && !t.ids.has(fragment)) c.add("PRF_BROKEN_LINK", path, `${target}#${fragment}`);
    }
  }
}

/** Validate a .flexova package. Never throws for malformed input; problems are reported as issues. */
export async function validate(input: Uint8Array | ArrayBuffer): Promise<Report> {
  // A plain Uint8Array view (not a Node Buffer), so every entry handed out is a plain Uint8Array too.
  const data =
    input instanceof Uint8Array
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
  const c = new Collector();
  const entries = readZip(data, c);
  if (!entries) return c.report();
  const pkg = checkPackage(entries, c);
  if (!pkg || c.fatal()) return c.report();
  await checkManifest(entries, c);
  if (c.fatal()) return c.report();
  checkResources(entries, pkg, c);
  return c.report();
}
