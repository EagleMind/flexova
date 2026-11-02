// Normative spec data bundled into the package (synced from spec/ by `pnpm sync:spec`).
import constantsJson from "./spec/constants.json" with { type: "json" };
import errorsJson from "./spec/errors.json" with { type: "json" };
import profileJson from "./spec/profile-1.0.json" with { type: "json" };

export type Severity = "error" | "warning";
export interface CodeSpec {
  phase: string;
  severity: Severity;
  fatal: boolean;
  message: string;
}
export type AttrSpec = string | { enum: string[] };
export interface ContentModel {
  type: "empty" | "text" | "inline" | "blocks" | "blocks-or-inline" | "children" | "sequence";
  allowed?: Record<string, [number, number | null]>;
  requireOneOf?: string[];
  items?: SequenceItem[];
}
export interface SequenceItem {
  element?: string;
  anyOf?: string[];
  category?: string;
  min: number;
  max: number | null;
}
export interface ElementDef {
  category: string;
  content: ContentModel;
  attributes?: Record<string, AttrSpec>;
  required?: string[];
  missingCodes?: Record<string, string>;
  targets?: Record<string, string[]>;
  excludes?: string[];
  mark?: boolean;
}
export interface AttrType {
  pattern?: string;
  kind?: "boolean" | "local-uri" | "link-uri";
  schemes?: string[];
}
export interface Profile {
  version: string;
  namespaces: Record<"xhtml" | "epub" | "mathml" | "svg" | "xlink" | "xml", string>;
  limits: {
    maxEntries: number;
    maxEntryBytes: number;
    maxTotalBytes: number;
    maxCompressionRatio: number;
    compressionRatioMinBytes: number;
    maxNestingDepth: number;
    maxManifestDepth: number;
  };
  entryNamePattern: string;
  mediaTypes: Record<string, string>;
  attributeTypes: Record<string, AttrType>;
  globalAttributes: Record<string, AttrSpec>;
  forbiddenElements: string[];
  forbiddenAttributePatterns: string[];
  elements: Record<string, ElementDef>;
  mathml: { root: string; rootCategory: string; elements: string[]; attributes: string[] };
}

export const CONSTANTS = constantsJson as Record<string, string>;
export const CODES = (errorsJson as unknown as { codes: Record<string, CodeSpec> }).codes;
export const PHASES = (errorsJson as unknown as { phases: string[] }).phases;
export const PROFILE = profileJson as unknown as Profile;

export const NS = PROFILE.namespaces;
export const CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";
export const OPF_NS = "http://www.idpf.org/2007/opf";
export const DC_NS = "http://purl.org/dc/elements/1.1/";
export const XHTML_TYPE = "application/xhtml+xml";
export const LIMITS = PROFILE.limits;
export const MEDIA_TYPES = PROFILE.mediaTypes;

/** Own-property lookup, safe for keys such as "__proto__" that come from untrusted documents. */
export function own<T>(obj: Record<string, T> | undefined, key: string): T | undefined {
  return obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}
