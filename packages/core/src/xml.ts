// Strict XML loading shared by every check: UTF-8 only, no DTDs, namespace-aware, comments and PIs dropped.
import { SaxesParser } from "saxes";

export const XML_WS = " \t\r\n";
const XMLDECL = /^<\?xml[^>]*?encoding[ \t\r\n]*=[ \t\r\n]*["']([^"']*)["']/;
const ENTITY = /<!ENTITY/i;
const DOCTYPE = /<!DOCTYPE/gi;
const DOCTYPE_HTML = /^<!DOCTYPE[ \t\r\n]+html[ \t\r\n]*>/i;

export const xmlTrim = (s: string): string => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
export const splitWs = (s: string): string[] => s.split(/[ \t\r\n]+/).filter(Boolean);

export interface XmlAttr {
  ns: string;
  local: string;
  value: string;
}

export class XmlElement {
  readonly children: (XmlElement | string)[] = [];
  constructor(
    readonly ns: string,
    readonly local: string,
    readonly attrs: XmlAttr[],
  ) {}

  attr(local: string, ns = ""): string | null {
    for (const a of this.attrs) if (a.ns === ns && a.local === local) return a.value;
    return null;
  }

  elements(): XmlElement[] {
    return this.children.filter((c): c is XmlElement => typeof c !== "string");
  }

  texts(): string[] {
    return this.children.filter((c): c is string => typeof c === "string");
  }

  /** Pre-order traversal of this element and every descendant element (iterative). */
  *iter(): Generator<XmlElement> {
    const stack: XmlElement[] = [this];
    while (stack.length) {
      const el = stack.pop() as XmlElement;
      yield el;
      const kids = el.elements();
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as XmlElement);
    }
  }

  text(): string {
    let out = "";
    const stack: (XmlElement | string)[] = [this];
    while (stack.length) {
      const node = stack.pop() as XmlElement | string;
      if (typeof node === "string") out += node;
      else
        for (let i = node.children.length - 1; i >= 0; i--)
          stack.push(node.children[i] as XmlElement | string);
    }
    return out;
  }
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Strict UTF-8 decode with an optional BOM removed; null if the bytes are not UTF-8. */
export function decodeUtf8(data: Uint8Array): string | null {
  let text: string;
  try {
    text = strictUtf8.decode(data);
  } catch {
    return null;
  }
  return text.startsWith("﻿") ? text.slice(1) : text;
}

export type XmlResult = { root: XmlElement; error: null } | { root: null; error: string };

export function parseXml(data: Uint8Array, allowHtmlDoctype: boolean): XmlResult {
  const text = decodeUtf8(data);
  if (text === null) return { root: null, error: "XML_ENCODING" };
  const decl = XMLDECL.exec(text);
  if (decl && (decl[1] ?? "").toLowerCase() !== "utf-8")
    return { root: null, error: "XML_ENCODING" };
  if (ENTITY.test(text)) return { root: null, error: "XML_DTD_FORBIDDEN" };
  for (const m of text.matchAll(DOCTYPE)) {
    if (!(allowHtmlDoctype && DOCTYPE_HTML.test(text.slice(m.index)))) {
      return { root: null, error: "XML_DTD_FORBIDDEN" };
    }
  }

  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  const addText = (data: string) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    const last = top.children.length - 1;
    if (last >= 0 && typeof top.children[last] === "string") top.children[last] += data;
    else top.children.push(data);
  };
  parser.on("error", (e) => {
    throw e;
  });
  parser.on("opentag", (tag) => {
    const attrs: XmlAttr[] = [];
    for (const a of Object.values(tag.attributes)) {
      if (a.prefix === "xmlns" || a.name === "xmlns") continue; // namespace declarations
      attrs.push({ ns: a.uri, local: a.local, value: a.value });
    }
    const el = new XmlElement(tag.uri, tag.local, attrs);
    const top = stack[stack.length - 1];
    if (top) top.children.push(el);
    else root = el;
    stack.push(el);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("text", addText);
  parser.on("cdata", addText);
  try {
    parser.write(text).close();
  } catch {
    return { root: null, error: "XML_MALFORMED" };
  }
  return root ? { root, error: null } : { root: null, error: "XML_MALFORMED" };
}
