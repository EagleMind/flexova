// Package-internal paths. Entry names are restricted to [A-Za-z0-9._-/] (profile entryNamePattern),
// so references never need percent-decoding or Unicode normalization.
import { PROFILE } from "./spec.js";

export const ENTRY_NAME = new RegExp(PROFILE.entryNamePattern);
export const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const BAD_CHARS = /[?#%\\ \t\r\n]/;

export const parentDir = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};

/**
 * Resolve a relative reference (no scheme, query or fragment) against a directory in the package.
 * Returns the package path, or null if the reference is malformed or escapes the package root.
 */
export function resolve(baseDir: string, ref: string): string | null {
  if (!ref || ref.startsWith("/") || BAD_CHARS.test(ref)) return null;
  const parts = baseDir ? baseDir.split("/") : [];
  for (const seg of ref.split("/")) {
    if (seg === "") return null;
    if (seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const path = parts.join("/");
  return ENTRY_NAME.test(path) ? path : null;
}
