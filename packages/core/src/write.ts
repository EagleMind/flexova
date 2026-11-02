// write(): build a deterministic .flexova package and refuse to return it unless it validates.
import { sha256Hex } from "./hash.js";
import { ENTRY_NAME } from "./paths.js";
import { FlexovaError } from "./report.js";
import { CONSTANTS, MEDIA_TYPES, own } from "./spec.js";
import { compileTokens, type Tokens } from "./tokens.js";
import { validate } from "./validate.js";
import { writeZip } from "./zip.js";

export interface Chapter {
  title: string;
  /** XHTML markup placed inside <body>. */
  body: string;
  /** File name under OEBPS/content/ (default: 01.xhtml, 02.xhtml, …). */
  file?: string;
}

export interface Asset {
  /** Path relative to OEBPS/, e.g. "assets/chart.svg". Chapters reference it as "../assets/chart.svg". */
  path: string;
  mediaType: string;
  data: Uint8Array;
}

export interface WriteInput {
  identifier: string;
  title: string;
  language: string;
  /** CCYY-MM-DDThh:mm:ssZ */
  modified: string;
  chapters: Chapter[];
  authors?: string[];
  tokens?: Tokens;
  assets?: Asset[];
  direction?: "ltr" | "rtl";
  navTitle?: string;
  accessibility?: {
    summary?: string;
    modes?: string[];
    sufficient?: string[];
    features?: string[];
    hazards?: string[];
  };
}

const CHAPTER_FILE = /^[A-Za-z0-9._-]+\.xhtml$/;
const RESERVED = new Set(["package.opf", "nav.xhtml", "styles/flexova.css"]);
const XMLNS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"';
const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s: string) => `"${text(s).replace(/"/g, "&quot;")}"`;
const utf8 = (s: string) => new TextEncoder().encode(s);
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function html(
  lang: string,
  dir: string | undefined,
  title: string,
  cssHref: string,
  body: string,
): Uint8Array {
  return utf8(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<html ${XMLNS} lang=${attr(lang)} xml:lang=${attr(lang)}${dir ? ` dir=${attr(dir)}` : ""}>` +
      `<head><meta charset="utf-8"/><title>${text(title)}</title>` +
      `<link rel="stylesheet" type="text/css" href=${attr(cssHref)}/></head>` +
      `<body>${body}</body></html>\n`,
  );
}

/**
 * Build a Flexova package. Throws TypeError for malformed input and FlexovaError if the result does not
 * validate, so a returned package is always valid. Output is byte-identical for identical input.
 */
export async function write(input: WriteInput): Promise<Uint8Array> {
  for (const key of ["identifier", "title", "language", "modified"] as const) {
    if (typeof input[key] !== "string" || !input[key]) throw new TypeError(`${key} is required`);
  }
  if (!input.chapters?.length) throw new TypeError("at least one chapter is required");
  const { language: lang, direction: dir } = input;
  const width = input.chapters.length >= 100 ? 3 : 2;

  const files = new Map<string, Uint8Array>();
  const chapters: { id: string; path: string; title: string; math: boolean }[] = [];
  input.chapters.forEach((ch, i) => {
    const name = ch.file ?? `${String(i + 1).padStart(width, "0")}.xhtml`;
    if (!CHAPTER_FILE.test(name))
      throw new TypeError(`invalid chapter file name ${JSON.stringify(name)}`);
    const path = `content/${name}`;
    if (files.has(path)) throw new TypeError(`duplicate chapter file ${JSON.stringify(name)}`);
    files.set(path, html(lang, dir, ch.title, "../styles/flexova.css", ch.body));
    chapters.push({
      id: `c${String(i + 1).padStart(3, "0")}`,
      path,
      title: ch.title,
      math: ch.body.includes("<math"),
    });
  });

  const assets: { id: string; path: string; mediaType: string }[] = [];
  (input.assets ?? []).forEach((asset, i) => {
    const { path, mediaType } = asset;
    if (
      !ENTRY_NAME.test(path) ||
      RESERVED.has(path) ||
      path.startsWith("content/") ||
      files.has(path)
    ) {
      throw new TypeError(`invalid or reserved asset path ${JSON.stringify(path)}`);
    }
    const kind = own(MEDIA_TYPES, mediaType);
    if (kind === undefined || kind === "content")
      throw new TypeError(`unsupported asset media type ${JSON.stringify(mediaType)}`);
    files.set(path, asset.data);
    assets.push({ id: `a${String(i + 1).padStart(3, "0")}`, path, mediaType });
  });

  const navTitle = input.navTitle || "Contents";
  const toc = chapters.map((ch) => `<li><a href="${ch.path}">${text(ch.title)}</a></li>`).join("");
  files.set(
    "nav.xhtml",
    html(
      lang,
      dir,
      navTitle,
      "styles/flexova.css",
      `<nav epub:type="toc" role="doc-toc" id="toc"><h1 id="toc-title">${text(navTitle)}</h1><ol>${toc}</ol></nav>`,
    ),
  );
  files.set("styles/flexova.css", utf8(compileTokens(input.tokens)));

  const hasImages = assets.some((a) => MEDIA_TYPES[a.mediaType] === "image");
  const hasMath = chapters.some((c) => c.math);
  const a11y = input.accessibility ?? {};
  const meta: [string, string][] = [
    ...(a11y.modes?.length ? a11y.modes : hasImages ? ["textual", "visual"] : ["textual"]).map(
      (m): [string, string] => ["schema:accessMode", m],
    ),
    ...(a11y.sufficient?.length ? a11y.sufficient : ["textual"]).map((s): [string, string] => [
      "schema:accessModeSufficient",
      s,
    ]),
    ...(a11y.features?.length
      ? a11y.features
      : [
          "structuralNavigation",
          "tableOfContents",
          ...(hasImages ? ["alternativeText"] : []),
          ...(hasMath ? ["MathML"] : []),
        ]
    ).map((f): [string, string] => ["schema:accessibilityFeature", f]),
    ...(a11y.hazards?.length ? a11y.hazards : ["none"]).map((h): [string, string] => [
      "schema:accessibilityHazard",
      h,
    ]),
    [
      "schema:accessibilitySummary",
      a11y.summary || "Reflowable, semantically structured text with a table of contents.",
    ],
  ];
  const items = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="styles/flexova.css" media-type="text/css"/>',
    ...chapters.map(
      (c) =>
        `<item id="${c.id}" href="${c.path}" media-type="application/xhtml+xml"${c.math ? ' properties="mathml"' : ""}/>`,
    ),
    ...assets.map((a) => `<item id="${a.id}" href="${a.path}" media-type="${a.mediaType}"/>`),
  ];
  const opf =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang=${attr(lang)} ` +
    `prefix=${attr(`flexova: ${CONSTANTS.namespaceUri}`)}>` +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:identifier id="uid">${text(input.identifier)}</dc:identifier>` +
    `<dc:title>${text(input.title)}</dc:title><dc:language>${text(lang)}</dc:language>` +
    (input.authors ?? []).map((a) => `<dc:creator>${text(a)}</dc:creator>`).join("") +
    `<meta property="dcterms:modified">${text(input.modified)}</meta>` +
    `<meta property="flexova:profile">${CONSTANTS.profileVersion}</meta>` +
    meta.map(([p, v]) => `<meta property="${p}">${text(v)}</meta>`).join("") +
    `</metadata><manifest>${items.join("")}</manifest><spine>` +
    chapters.map((c) => `<itemref idref="${c.id}"/>`).join("") +
    "</spine></package>\n";
  files.set("package.opf", utf8(opf));

  const entries = new Map<string, Uint8Array>([...files].map(([p, d]) => [`OEBPS/${p}`, d]));
  entries.set(
    "META-INF/container.xml",
    utf8(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>' +
        '<rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>' +
        "</rootfiles></container>\n",
    ),
  );
  const listed = [];
  for (const name of [...entries.keys()].sort(byCodePoint)) {
    const data = entries.get(name) as Uint8Array;
    listed.push({ path: name, size: data.length, sha256: await sha256Hex(data) });
  }
  const manifest = {
    flexova: CONSTANTS.profileVersion,
    level: "L0",
    ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
    entries: listed,
  };
  entries.set(CONSTANTS.manifestPath as string, utf8(JSON.stringify(manifest, null, 2) + "\n"));

  const pkg = writeZip([
    { name: "mimetype", data: utf8(CONSTANTS.containerMimetype as string), compress: false },
    ...[...entries.keys()]
      .sort(byCodePoint)
      .map((name) => ({ name, data: entries.get(name) as Uint8Array, compress: true })),
  ]);
  const report = await validate(pkg);
  if (!report.valid) throw new FlexovaError(report);
  return pkg;
}
