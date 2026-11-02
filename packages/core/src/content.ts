// Content-profile validation of one XHTML document against spec/profile/profile-1.0.json.
import { SCHEME, parentDir, resolve } from "./paths.js";
import type { Collector } from "./report.js";
import {
  LIMITS,
  MEDIA_TYPES,
  NS,
  PROFILE,
  XHTML_TYPE,
  own,
  type AttrSpec,
  type ContentModel,
  type ElementDef,
  type SequenceItem,
} from "./spec.js";
import { XML_WS, splitWs, type XmlElement } from "./xml.js";

const FORBIDDEN_ELEMENTS = new Set(PROFILE.forbiddenElements);
const FORBIDDEN_ATTRS = PROFILE.forbiddenAttributePatterns.map((p) => new RegExp(p, "i"));
const MATHML_ELEMENTS = new Set(PROFILE.mathml.elements);
const MATHML_ATTRS = new Set(PROFILE.mathml.attributes);
const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const PREFIXES: Record<string, string> = {
  [NS.xml]: "xml:",
  [NS.epub]: "epub:",
  [NS.xlink]: "xlink:",
};
const PATTERNS = new Map<string, RegExp>();
const hasText = (s: string) => [...s].some((ch) => !XML_WS.includes(ch));

export function canonicalAttr(ns: string, local: string): string {
  if (!ns) return local;
  const prefix = own(PREFIXES, ns);
  return prefix ? prefix + local : `{${ns}}${local}`;
}

type Kind = "forbidden" | "unknown" | "xhtml" | "mathml";

export function classify(el: XmlElement): [Kind, ElementDef | null] {
  if (FORBIDDEN_ELEMENTS.has(el.local)) return ["forbidden", null];
  const def = el.ns === NS.xhtml ? own(PROFILE.elements, el.local) : undefined;
  if (def) return ["xhtml", def];
  if (el.ns === NS.mathml && MATHML_ELEMENTS.has(el.local)) return ["mathml", null];
  return ["unknown", null];
}

function category(el: XmlElement): string | null {
  const [kind, def] = classify(el);
  if (kind === "xhtml") return (def as ElementDef).category;
  if (kind === "mathml")
    return el.local === PROFILE.mathml.root ? PROFILE.mathml.rootCategory : "mathml";
  return null; // forbidden/unknown children are reported on their own and ignored by content models
}

export interface Package {
  byPath: Map<string, { mediaType: string }>;
}

export class ContentValidator {
  readonly ids = new Set<string>();
  hasToc = false;
  readonly sameDocFragments: string[] = [];
  readonly crossDocLinks: [string, string][] = [];
  private readonly dir: string;
  private readonly headings: number[] = [];
  private tooDeep = false;

  constructor(
    readonly path: string,
    private readonly pkg: Package,
    private readonly c: Collector,
  ) {
    this.dir = parentDir(path);
  }

  run(root: XmlElement): void {
    this.visit(root, 1, new Set());
    let prev: number | null = null;
    for (const level of this.headings) {
      if (prev !== null && level > prev + 1) {
        this.c.add("PRF_HEADING_SKIP", this.path, `h${prev} followed by h${level}`);
        break;
      }
      prev = level;
    }
  }

  private visit(el: XmlElement, depth: number, excluded: Set<string>): void {
    if (depth > LIMITS.maxNestingDepth) {
      if (!this.tooDeep) this.c.add("PRF_TOO_DEEP", this.path);
      this.tooDeep = true;
      return;
    }
    const [kind, def] = classify(el);
    if (kind === "forbidden")
      return this.c.add("PRF_FORBIDDEN_ELEMENT", this.path, `<${el.local}>`);
    if (kind === "unknown") return this.c.add("PRF_UNKNOWN_ELEMENT", this.path, `<${el.local}>`);
    if (kind === "xhtml" && excluded.has(el.local)) {
      this.c.add(
        "PRF_CONTENT_MODEL",
        this.path,
        `<${el.local}> may not be nested in another <${el.local}>`,
      );
    }
    this.checkAttributes(el, kind, def);
    let next = excluded;
    if (kind === "xhtml") {
      const d = def as ElementDef;
      const level = own(HEADINGS, el.local);
      if (level !== undefined) this.headings.push(level);
      if (
        el.local === "table" &&
        ![...el.iter()].some((e) => e.ns === NS.xhtml && e.local === "th")
      ) {
        this.c.add("PRF_TABLE_NO_HEADERS", this.path, el.attr("id") ?? "");
      }
      if (el.local === "nav" && splitWs(el.attr("type", NS.epub) ?? "").includes("toc"))
        this.hasToc = true;
      this.checkContent(el, d.content);
      if (d.excludes?.length) next = new Set([...excluded, ...d.excludes]);
    } else {
      for (const kid of el.elements()) {
        if (classify(kid)[0] === "xhtml")
          this.c.add("PRF_CONTENT_MODEL", this.path, `<${kid.local}> inside MathML`);
      }
    }
    for (const kid of el.elements()) this.visit(kid, depth + 1, next);
  }

  private checkContent(el: XmlElement, model: ContentModel): void {
    const kids = el.elements().filter((k) => category(k) !== null);
    const text = el.texts().some(hasText);
    const bad = (detail: string) =>
      this.c.add("PRF_CONTENT_MODEL", this.path, `<${el.local}>: ${detail}`);
    switch (model.type) {
      case "empty":
        if (kids.length || text) bad("must be empty");
        break;
      case "text":
        if (kids.length) bad("may contain text only");
        break;
      case "inline":
        for (const k of kids)
          if (category(k) !== "inline") bad(`<${k.local}> is not inline content`);
        break;
      case "blocks":
        if (text) bad("text must be wrapped in a block element");
        for (const k of kids) if (category(k) !== "block") bad(`<${k.local}> is not block content`);
        break;
      case "blocks-or-inline":
        if (kids.some((k) => category(k) === "block")) {
          if (text) bad("mixes text with block content");
          for (const k of kids)
            if (category(k) !== "block") bad(`<${k.local}> mixes inline with block content`);
        } else {
          for (const k of kids)
            if (category(k) !== "inline") bad(`<${k.local}> is not inline content`);
        }
        break;
      case "children": {
        const allowed = model.allowed ?? {};
        if (text) bad("text is not allowed here");
        const counts = new Map<string, number>();
        for (const k of kids) {
          if (own(allowed, k.local)) counts.set(k.local, (counts.get(k.local) ?? 0) + 1);
          else bad(`<${k.local}> is not allowed here`);
        }
        for (const [name, [lo, hi]] of Object.entries(allowed)) {
          const n = counts.get(name) ?? 0;
          if (n < lo || (hi !== null && n > hi))
            bad(`<${name}> count ${n} is outside [${lo}, ${hi}]`);
        }
        if (model.requireOneOf && !model.requireOneOf.some((n) => (counts.get(n) ?? 0) > 0)) {
          bad("missing required content");
        }
        break;
      }
      case "sequence": {
        if (text) bad("text is not allowed here");
        let i = 0;
        for (const item of model.items ?? []) {
          let count = 0;
          while (
            i < kids.length &&
            matches(item, kids[i] as XmlElement) &&
            (item.max === null || count < item.max)
          ) {
            count++;
            i++;
          }
          if (count < item.min) bad("required child is missing or out of order");
        }
        if (i < kids.length) bad(`<${(kids[i] as XmlElement).local}> is not allowed here`);
        break;
      }
    }
  }

  private checkAttributes(el: XmlElement, kind: Kind, def: ElementDef | null): void {
    const present = new Map<string, string>();
    for (const { ns, local, value } of el.attrs) {
      const name = canonicalAttr(ns, local);
      if (FORBIDDEN_ATTRS.some((p) => p.test(name))) {
        this.c.add("PRF_FORBIDDEN_ATTRIBUTE", this.path, `${name} on <${el.local}>`);
        continue;
      }
      const spec: AttrSpec | undefined =
        kind === "mathml"
          ? !ns && MATHML_ATTRS.has(local)
            ? "text"
            : undefined
          : (own(def?.attributes, name) ?? own(PROFILE.globalAttributes, name));
      if (spec === undefined) {
        this.c.add("PRF_ATTRIBUTE_NOT_ALLOWED", this.path, `${name} on <${el.local}>`);
        continue;
      }
      present.set(name, value);
      this.checkValue(el, name, value, spec, def);
    }
    if (kind === "xhtml" && def) {
      for (const req of def.required ?? []) {
        if (!present.has(req)) {
          this.c.add(
            own(def.missingCodes, req) ?? "PRF_MISSING_ATTRIBUTE",
            this.path,
            `${req} on <${el.local}>`,
          );
        }
      }
      const lang = present.get("lang");
      const xmlLang = present.get("xml:lang");
      if (
        el.local === "html" &&
        lang !== undefined &&
        xmlLang !== undefined &&
        lang.toLowerCase() !== xmlLang.toLowerCase()
      ) {
        this.c.add("PRF_INVALID_VALUE", this.path, "lang and xml:lang differ");
      }
    }
    const id = present.get("id");
    if (id !== undefined) {
      if (this.ids.has(id)) this.c.add("PRF_DUPLICATE_ID", this.path, id);
      this.ids.add(id);
    }
  }

  private checkValue(
    el: XmlElement,
    name: string,
    value: string,
    spec: AttrSpec,
    def: ElementDef | null,
  ): void {
    const where = `${name}=${JSON.stringify(value)} on <${el.local}>`;
    if (typeof spec !== "string") {
      if (!spec.enum.includes(value)) this.c.add("PRF_INVALID_VALUE", this.path, where);
      return;
    }
    const t = PROFILE.attributeTypes[spec];
    if (!t) throw new Error(`profile references unknown attribute type ${spec}`);
    if (t.pattern !== undefined) {
      let re = PATTERNS.get(t.pattern);
      if (!re) PATTERNS.set(t.pattern, (re = new RegExp(t.pattern)));
      if (!re.test(value)) this.c.add("PRF_INVALID_VALUE", this.path, where);
    }
    if (t.kind === "boolean" && value !== "" && value !== name)
      this.c.add("PRF_INVALID_VALUE", this.path, where);
    else if (t.kind === "local-uri")
      this.checkLocalUri(where, value, own(def?.targets, name) ?? []);
    else if (t.kind === "link-uri") this.checkLink(value, t.schemes ?? []);
  }

  private checkLocalUri(where: string, value: string, targetKinds: string[]): void {
    if (SCHEME.test(value) || value.startsWith("//")) {
      const scheme = (value.split(":", 1)[0] ?? "").toLowerCase();
      const remote = value.startsWith("//") || scheme === "http" || scheme === "https";
      this.c.add(remote ? "PRF_REMOTE_RESOURCE" : "PRF_INVALID_VALUE", this.path, where);
      return;
    }
    const target = resolve(this.dir, value);
    if (target === null) return this.c.add("PRF_INVALID_VALUE", this.path, where);
    const item = this.pkg.byPath.get(target);
    if (!item) return this.c.add("PRF_BROKEN_REFERENCE", this.path, where);
    const kind = own(MEDIA_TYPES, item.mediaType);
    if (targetKinds.length && (kind === undefined || !targetKinds.includes(kind))) {
      this.c.add("PRF_INVALID_VALUE", this.path, `${where} has the wrong media type`);
    }
  }

  private checkLink(value: string, schemes: string[]): void {
    const where = `href=${JSON.stringify(value)}`;
    if (SCHEME.test(value)) {
      if (!schemes.includes((value.split(":", 1)[0] ?? "").toLowerCase()))
        this.c.add("PRF_INVALID_VALUE", this.path, where);
      return;
    }
    if (value.startsWith("//") || [...("?%\\" + XML_WS)].some((ch) => value.includes(ch))) {
      return this.c.add("PRF_INVALID_VALUE", this.path, where);
    }
    const hash = value.indexOf("#");
    const pathPart = hash < 0 ? value : value.slice(0, hash);
    const fragment = hash < 0 ? "" : value.slice(hash + 1);
    if (!pathPart) {
      if (fragment) this.sameDocFragments.push(fragment);
      else this.c.add("PRF_BROKEN_LINK", this.path, where);
      return;
    }
    const target = resolve(this.dir, pathPart);
    if (target === null) return this.c.add("PRF_INVALID_VALUE", this.path, where);
    const item = this.pkg.byPath.get(target);
    if (!item || item.mediaType !== XHTML_TYPE || (hash >= 0 && !fragment)) {
      return this.c.add("PRF_BROKEN_LINK", this.path, where);
    }
    if (fragment) this.crossDocLinks.push([target, fragment]);
  }
}

function matches(item: SequenceItem, kid: XmlElement): boolean {
  if (item.element !== undefined) return kid.local === item.element;
  if (item.anyOf !== undefined) return item.anyOf.includes(kid.local);
  return category(kid) === item.category;
}
