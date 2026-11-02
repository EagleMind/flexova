// Design tokens: validation, WCAG contrast checks and compilation to CSS.
// compileTokens() output is specified byte-for-byte by conformance/vectors/compile-tokens.json.
import type { Collector } from "./report.js";
import { own } from "./spec.js";

const COLOR_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT_KEYS = ["body", "heading", "mono"] as const;
export const FONT_STACKS: Record<string, string> = {
  system: 'system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif',
  serif: 'Charter,"Iowan Old Style",Georgia,"Times New Roman",serif',
  sans: '"Helvetica Neue",Arial,"Noto Sans",sans-serif',
  mono: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
};
const DEFAULT_COLORS: [string, string, string][] = [
  ["fg", "#1a1a1a", "#e8e6e3"],
  ["bg", "#ffffff", "#121212"],
  ["accent", "#0b5fff", "#7aa7ff"],
  ["muted", "#52525b", "#a1a1aa"],
  ["surface", "#f4f4f5", "#1e1e22"],
  ["note-bg", "#eef4ff", "#16233d"],
  ["warning-bg", "#fff4e5", "#3a2a12"],
];
const TEXT_COLORS = ["fg", "accent", "muted"];
const MIN_CONTRAST = 4.5;

/** The colors viewers use when a document doesn't set them, by name. */
export function defaultColors(): Record<string, { light: string; dark: string }> {
  return Object.fromEntries(DEFAULT_COLORS.map(([name, light, dark]) => [name, { light, dark }]));
}

/** The contrast rule behind MAN_LOW_CONTRAST: each text color against the background, in both themes. */
export const CONTRAST_RULE = {
  background: "bg",
  text: TEXT_COLORS,
  minimum: MIN_CONTRAST,
} as const;

export interface Tokens {
  color?: Record<string, { light: string; dark: string }>;
  font?: { body?: string; heading?: string; mono?: string };
  measure?: number;
  [group: string]: unknown;
}

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: Record<string, Json>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** JSON integer, matching the Python reference (5 and 5.0 are the same JSON number). */
export const isInteger = (v: Json): v is number => typeof v === "number" && Number.isInteger(v);

function validColor(name: string, value: Json): value is { light: string; dark: string } {
  if (!COLOR_NAME.test(name) || !isObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 2 &&
    has(value, "light") &&
    has(value, "dark") &&
    typeof value.light === "string" &&
    HEX.test(value.light) &&
    typeof value.dark === "string" &&
    HEX.test(value.dark)
  );
}

const validFont = (v: Json): v is Record<string, string> =>
  isObject(v) &&
  Object.keys(v).every(
    (k) =>
      (FONT_KEYS as readonly string[]).includes(k) &&
      typeof v[k] === "string" &&
      has(FONT_STACKS, v[k] as string),
  );
const validMeasure = (v: Json): v is number => isInteger(v) && v >= 40 && v <= 100;

function luminance(hex: string): number {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join("");
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function checkTokens(tokens: Json, c: Collector, path: string): void {
  if (!isObject(tokens)) {
    c.add("MAN_INVALID", path, "tokens must be an object");
    return;
  }
  const colors: Record<string, { light: string; dark: string }> = {};
  if (has(tokens, "color")) {
    const group = tokens.color;
    if (!isObject(group)) {
      c.add("MAN_INVALID_TOKEN", path, "color must be an object");
    } else {
      for (const name of Object.keys(group).sort(byCodePoint)) {
        const value = group[name];
        if (validColor(name, value)) colors[name] = value;
        else c.add("MAN_INVALID_TOKEN", path, `color.${name}`);
      }
    }
  }
  if (has(tokens, "font") && !validFont(tokens.font)) c.add("MAN_INVALID_TOKEN", path, "font");
  if (has(tokens, "measure") && !validMeasure(tokens.measure))
    c.add("MAN_INVALID_TOKEN", path, "measure");
  const bg = own(colors, "bg");
  if (bg) {
    for (const name of TEXT_COLORS) {
      const fg = own(colors, name);
      if (fg && (["light", "dark"] as const).some((m) => contrast(fg[m], bg[m]) < MIN_CONTRAST)) {
        c.add("MAN_LOW_CONTRAST", path, `color.${name} on color.bg`);
      }
    }
  }
}

/** Compile design tokens into the package stylesheet. Invalid tokens are ignored (validation reports them). */
export function compileTokens(tokens?: Json): string {
  const t = isObject(tokens) ? tokens : {};
  const group = isObject(t.color) ? t.color : {};
  const colors = new Map<string, [string, string]>(DEFAULT_COLORS.map(([n, l, d]) => [n, [l, d]]));
  for (const name of Object.keys(group).sort(byCodePoint)) {
    const value = group[name];
    if (validColor(name, value))
      colors.set(name, [value.light.toLowerCase(), value.dark.toLowerCase()]);
  }
  const defaults = DEFAULT_COLORS.map(([n]) => n);
  const order = [
    ...defaults,
    ...[...colors.keys()].filter((n) => !defaults.includes(n)).sort(byCodePoint),
  ];
  const font = validFont(t.font) ? t.font : {};
  const body = own(font, "body") ?? "system";
  const fonts: Record<string, string> = {
    body,
    heading: own(font, "heading") ?? body,
    mono: own(font, "mono") ?? "mono",
  };
  const measure = validMeasure(t.measure) ? t.measure : 68;

  const vars = (mode: 0 | 1) =>
    order.map((n) => `--flexova-${n}:${(colors.get(n) as [string, string])[mode]};`).join("");
  const fontVars = FONT_KEYS.map(
    (k) => `--flexova-font-${k}:${FONT_STACKS[fonts[k] as string]};`,
  ).join("");
  const lines = [
    "/* Generated by Flexova from design tokens. Do not edit. */",
    `:root{color-scheme:light dark;${vars(0)}${fontVars}--flexova-measure:${measure}ch}`,
    `@media (prefers-color-scheme:dark){:root{${vars(1).replace(/;$/, "")}}}`,
    "html{-webkit-text-size-adjust:100%;text-size-adjust:100%}",
    "body{margin:0 auto;max-width:var(--flexova-measure);padding:0 1rem;background:var(--flexova-bg);" +
      "color:var(--flexova-fg);font-family:var(--flexova-font-body);font-size:1.0625rem;line-height:1.6;" +
      "overflow-wrap:break-word}",
    "h1,h2,h3,h4,h5,h6{font-family:var(--flexova-font-heading);line-height:1.25}",
    "a{color:var(--flexova-accent)}",
    "img{max-width:100%;height:auto}",
    "figure{margin-inline:0}",
    "figcaption{color:var(--flexova-muted);font-size:.9em}",
    "pre{overflow-x:auto;padding:1rem;background:var(--flexova-surface)}",
    "code,kbd,samp,pre{font-family:var(--flexova-font-mono)}",
    "table{border-collapse:collapse;max-width:100%}",
    "th,td{padding:.4em .6em;text-align:start;border-bottom:1px solid var(--flexova-surface)}",
    "aside[role=note]{padding:.5em 1em;border-radius:6px;background:var(--flexova-note-bg)}",
    "aside[data-flexova-variant=warning],aside[data-flexova-variant=caution]{background:var(--flexova-warning-bg)}",
    "@media (prefers-color-scheme:dark){img{filter:brightness(.9)}}",
  ];
  return lines.join("\n") + "\n";
}
