// read() and pack(): open a valid package for rendering tools, and re-pack entries deterministically.
import { Collector, FlexovaError, type Report } from "./report.js";
import { CONSTANTS } from "./spec.js";
import type { Tokens } from "./tokens.js";
import { checkPackage, validate } from "./validate.js";
import { readZip, writeZip } from "./zip.js";

export interface PackageItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
}

export interface FlexovaPackage {
  /** Every file entry, by path. */
  entries: Map<string, Uint8Array>;
  opfPath: string;
  title: string;
  language: string;
  /** The package's unique identifier (dc:identifier), stable across versions of a document. */
  identifier: string;
  /** dcterms:modified, e.g. "2026-11-02T00:00:00Z". */
  modified: string;
  /** dc:creator values, in document order. */
  authors: string[];
  /** Content documents in reading order. */
  spine: string[];
  /** Package document items, in document order. */
  items: PackageItem[];
  navPath: string | null;
  tokens: Tokens | undefined;
  /** The validation report (valid, possibly with warnings). */
  report: Report;
}

/** Validate and open a package. Throws FlexovaError if it is not valid. */
export async function read(input: Uint8Array | ArrayBuffer): Promise<FlexovaPackage> {
  // A plain Uint8Array view (not a Node Buffer), so every entry handed out is a plain Uint8Array too.
  const data =
    input instanceof Uint8Array
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
  const report = await validate(data);
  if (!report.valid) throw new FlexovaError(report);
  const c = new Collector();
  const entries = readZip(data, c) as Map<string, Uint8Array>;
  const pkg = checkPackage(entries, c);
  if (!pkg) throw new FlexovaError(report); // unreachable for a valid package
  const manifest = JSON.parse(
    new TextDecoder().decode(entries.get(CONSTANTS.manifestPath as string)),
  );
  return {
    entries,
    opfPath: pkg.opfPath,
    title: pkg.title,
    language: pkg.language,
    identifier: pkg.identifier,
    modified: pkg.modified,
    authors: pkg.authors,
    spine: pkg.spine,
    items: pkg.items.map(({ id, path, mediaType, properties }) => ({
      id,
      path,
      mediaType,
      properties,
    })),
    navPath: pkg.navPath,
    tokens: manifest.tokens,
    report,
  };
}

/**
 * Safely unpack a ZIP produced by pack() (or any Flexova-shaped ZIP) into its entries, enforcing every
 * ZIP-phase rule of the spec (limits, names, mimetype first). Throws FlexovaError if any rule fails.
 */
export function unpack(input: Uint8Array): Map<string, Uint8Array> {
  const c = new Collector();
  const entries = readZip(new Uint8Array(input.buffer, input.byteOffset, input.byteLength), c);
  if (!entries) throw new FlexovaError(c.report());
  return entries;
}

/**
 * Deterministically re-pack entries into a ZIP: `mimetype` first and stored, every other entry deflated in
 * code-point order of name. Does not validate; pass the result to validate() if needed.
 */
export function pack(entries: Map<string, Uint8Array>): Uint8Array {
  const names = [...entries.keys()]
    .filter((n) => n !== "mimetype")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return writeZip([
    ...(entries.has("mimetype")
      ? [{ name: "mimetype", data: entries.get("mimetype") as Uint8Array, compress: false }]
      : []),
    ...names.map((name) => ({ name, data: entries.get(name) as Uint8Array, compress: true })),
  ]);
}
