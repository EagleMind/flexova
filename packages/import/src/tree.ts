// A minimal element tree that always serializes to well-formed XHTML in the Flexova profile's shape.
export type Node = string | El;

export interface El {
  name: string;
  attrs: Record<string, string>;
  children: Node[];
}

export function el(
  name: string,
  attrs: Record<string, string | undefined> = {},
  children: Node[] = [],
): El {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined) clean[key] = value;
  return { name, attrs: clean, children };
}

// Elements whose profile category is "block"; everything else (and text) is inline.
const BLOCK = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "dl",
  "blockquote",
  "aside",
  "figure",
  "table",
  "pre",
  "hr",
  "details",
  "section",
  "nav",
]);
const VOID = new Set(["img", "br", "hr", "source", "meta", "link"]);
// Characters XML 1.0 forbids, including lone surrogates.
const ILLEGAL =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export const isBlock = (n: Node): boolean => typeof n !== "string" && BLOCK.has(n.name);
const blank = (n: Node) => typeof n === "string" && !/\S/.test(n);

function escape(text: string): string {
  return text
    .replace(ILLEGAL, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function serialize(node: Node): string {
  if (typeof node === "string") return escape(node);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escape(v).replace(/"/g, "&quot;")}"`)
    .join("");
  if (VOID.has(node.name)) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(serialize).join("")}</${node.name}>`;
}

/** Plain text of a subtree, for titles, alt text and slugs. */
export function textOf(nodes: Node[]): string {
  return nodes.map((n) => (typeof n === "string" ? n : textOf(n.children))).join("");
}

/** Merge adjacent strings and drop empty ones. */
export function tidy(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (n === "") continue;
    const last = out[out.length - 1];
    if (typeof n === "string" && typeof last === "string") out[out.length - 1] = last + n;
    else out.push(n);
  }
  return out;
}

/** Content for a "blocks" container: runs of inline content are wrapped in paragraphs. */
export function asBlocks(nodes: Node[]): Node[] {
  const out: Node[] = [];
  let run: Node[] = [];
  const flush = () => {
    const trimmed = trim(run);
    if (trimmed.length) out.push(el("p", {}, trimmed));
    run = [];
  };
  for (const n of nodes) {
    if (isBlock(n)) {
      flush();
      out.push(n);
    } else run.push(n);
  }
  flush();
  return out;
}

/** Content for a "blocks-or-inline" container (li, dd, td, th, figcaption): never a mixture. */
export function asFlow(nodes: Node[]): Node[] {
  const meaningful = nodes.filter((n) => !blank(n));
  if (!meaningful.some(isBlock)) return trim(nodes);
  return asBlocks(nodes);
}

/** Inline content without leading or trailing whitespace. */
export function trim(nodes: Node[]): Node[] {
  const out = tidy(nodes);
  if (typeof out[0] === "string") out[0] = out[0].replace(/^\s+/, "");
  const last = out.length - 1;
  if (typeof out[last] === "string") out[last] = (out[last] as string).replace(/\s+$/, "");
  return tidy(out);
}
