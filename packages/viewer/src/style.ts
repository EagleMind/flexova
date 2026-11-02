// Viewer stylesheet. Theme variables are compiled from validated design tokens with the same palette and
// rules as @flexova/core's compileTokens() (a parity test keeps them identical); documents never supply CSS.

const DEFAULTS: [string, string, string][] = [
  ["fg", "#1a1a1a", "#e8e6e3"],
  ["bg", "#ffffff", "#121212"],
  ["accent", "#0b5fff", "#7aa7ff"],
  ["muted", "#52525b", "#a1a1aa"],
  ["surface", "#f4f4f5", "#1e1e22"],
  ["note-bg", "#eef4ff", "#16233d"],
  ["warning-bg", "#fff4e5", "#3a2a12"],
];
const FONTS: Record<string, string> = {
  system: 'system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif',
  serif: 'Charter,"Iowan Old Style",Georgia,"Times New Roman",serif',
  sans: '"Helvetica Neue",Arial,"Noto Sans",sans-serif',
  mono: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
};
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Theme custom properties: [light declarations, dark declarations, font and measure declarations]. */
export function themeVars(tokens: unknown): [string, string, string] {
  const t = isObj(tokens) ? tokens : {};
  const colors = new Map<string, string[]>(DEFAULTS.map(([n, l, d]) => [n, [l, d]]));
  const group = isObj(t.color) ? t.color : {};
  const extra: string[] = [];
  for (const name of Object.keys(group).sort()) {
    const v = group[name];
    if (
      NAME.test(name) &&
      isObj(v) &&
      Object.keys(v).length === 2 &&
      typeof v.light === "string" &&
      HEX.test(v.light) &&
      typeof v.dark === "string" &&
      HEX.test(v.dark)
    ) {
      if (!colors.has(name)) extra.push(name);
      colors.set(name, [v.light.toLowerCase(), v.dark.toLowerCase()]);
    }
  }
  const order = [...DEFAULTS.map(([n]) => n), ...extra];
  const vars = (i: number) =>
    order.map((n) => `--flexova-${n}:${(colors.get(n) as string[])[i]};`).join("");
  const f = t.font;
  const font =
    isObj(f) &&
    Object.keys(f).every(
      (k) =>
        ["body", "heading", "mono"].includes(k) &&
        typeof f[k] === "string" &&
        has(FONTS, f[k] as string),
    )
      ? (f as Record<string, string>)
      : {};
  const body = font.body ?? "system";
  const m = t.measure;
  const measure = typeof m === "number" && Number.isInteger(m) && m >= 40 && m <= 100 ? m : 68;
  const fonts =
    `--flexova-font-body:${FONTS[body]};--flexova-font-heading:${FONTS[font.heading ?? body]};` +
    `--flexova-font-mono:${FONTS[font.mono ?? "mono"]};--flexova-measure:${measure}ch;`;
  return [vars(0), vars(1), fonts];
}

export function viewerCss(tokens: unknown): string {
  const [light, dark, fonts] = themeVars(tokens);
  const dim = "img{filter:brightness(.9)}";
  return (
    `:host{all:initial;display:block;color-scheme:light dark;background:var(--flexova-bg);${light}${fonts}}` +
    `:host([theme=light]){color-scheme:light}:host([theme=dark]){color-scheme:dark;${dark}}` +
    `@media (prefers-color-scheme:dark){:host(:not([theme=light])){${dark}}:host(:not([theme=light])) ${dim}}` +
    `:host([theme=dark]) ${dim}` +
    ".fx{box-sizing:border-box;max-width:var(--flexova-measure);margin:0 auto;padding:1rem;color:var(--flexova-fg);" +
    "font-family:var(--flexova-font-body);font-size:1.0625rem;line-height:1.6;overflow-wrap:break-word}" +
    ".fx-doc+.fx-doc{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--flexova-surface)}" +
    "h1,h2,h3,h4,h5,h6{font-family:var(--flexova-font-heading);line-height:1.25}" +
    "a{color:var(--flexova-accent)}img{max-width:100%;height:auto}figure{margin-inline:0}" +
    "figcaption{color:var(--flexova-muted);font-size:.9em}" +
    "pre{overflow-x:auto;padding:1rem;background:var(--flexova-surface)}code,kbd,samp,pre{font-family:var(--flexova-font-mono)}" +
    ".fx-scroll{overflow-x:auto;max-width:100%}table{border-collapse:collapse}" +
    "th,td{padding:.4em .6em;text-align:start;border-bottom:1px solid var(--flexova-surface)}" +
    "aside[role=note]{padding:.5em 1em;border-radius:6px;background:var(--flexova-note-bg)}" +
    "aside[data-flexova-variant=warning],aside[data-flexova-variant=caution]{background:var(--flexova-warning-bg)}" +
    "math[display=block]{overflow-x:auto;max-width:100%}audio{max-width:100%}" +
    ".fx-error{padding:1rem;border-radius:6px;background:var(--flexova-warning-bg)}"
  );
}
