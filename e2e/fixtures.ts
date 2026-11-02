import { readFileSync } from "node:fs";

export const ROOT = new URL("../", import.meta.url);
export const CONFORMANCE = new URL("conformance/", ROOT);
export const HTML_DIR = new URL("build/e2e/html/", ROOT);

interface Expected {
  valid: boolean;
  codes: string[];
}
const expected = (): Record<string, Expected> =>
  JSON.parse(readFileSync(new URL("expected.json", CONFORMANCE), "utf8")).fixtures;

export const validFixtures = () => Object.keys(expected()).filter((k) => expected()[k]?.valid);
export const rejectedFixtures = () => Object.keys(expected()).filter((k) => !expected()[k]?.valid);

/** Fixtures that exercise the most rendering features: run across every width and theme. */
export const SHOWCASE = [
  "valid/block-elements.flexova",
  "valid/images.flexova",
  "valid/tables-complex.flexova",
  "valid/links.flexova",
  "valid/mathml.flexova",
  "valid/right-to-left.flexova",
];
export const WIDTHS = [320, 375, 768, 1280];
export const THEMES = ["light", "dark"] as const;

/** WCAG 2.2 A/AA rules (axe best-practice rules are advisory, not pass/fail). */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** File name of a fixture's static rendition in HTML_DIR. */
export const htmlName = (rel: string) =>
  rel.replace("/", "-").replace(/\.flexova$/, ".flexova.html");
