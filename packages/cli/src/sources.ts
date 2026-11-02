// Build inputs: a Markdown file, a project folder (flexova.config.json), or anything Pandoc reads.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type { Tokens, WriteInput } from "@flexova/core";
import { fromMarkdown, fromPandoc, type ImportResult, type Variant } from "@flexova/import";

export class UsageError extends Error {}
export class ToolError extends Error {}

export const CONFIG_FILE = "flexova.config.json";
const MARKDOWN = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const VARIANTS = new Set(["note", "tip", "important", "warning", "caution"]);

export interface ProjectConfig {
  title?: string;
  language?: string;
  authors?: string[];
  identifier?: string;
  modified?: string;
  /** Markdown files in reading order, relative to the project folder. Default: every .md file, sorted. */
  chapters?: string[];
  tokens?: Tokens;
  accessibility?: WriteInput["accessibility"];
  /** Word/ODT paragraph styles that become callouts, for Pandoc sources. */
  styleMap?: Record<string, Variant>;
}

export interface BuildSettings {
  title?: string | undefined;
  language?: string | undefined;
  authors?: string[] | undefined;
  styleMap?: Record<string, Variant> | undefined;
}

export interface Loaded {
  result: ImportResult;
  config: ProjectConfig;
  /** Bytes that identify the input, for a stable default identifier. */
  fingerprint: Uint8Array;
}

/** Read a file inside `root`, refusing paths that escape it. */
function reader(root: string): (path: string) => Uint8Array | undefined {
  const base = resolve(root);
  return (path) => {
    const full = resolve(base, path);
    if (full !== base && !full.startsWith(base + sep)) return undefined;
    try {
      return statSync(full).isFile() ? readFileSync(full) : undefined;
    } catch {
      return undefined;
    }
  };
}

function readConfig(dir: string): ProjectConfig {
  const path = join(dir, CONFIG_FILE);
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new UsageError(`${path}: ${(e as Error).message}`);
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new UsageError(`${path}: expected a JSON object`);
  }
  const c = config as ProjectConfig;
  if (
    c.chapters !== undefined &&
    !(Array.isArray(c.chapters) && c.chapters.every((x) => typeof x === "string"))
  ) {
    throw new UsageError(`${path}: "chapters" must be a list of Markdown file paths`);
  }
  for (const [style, variant] of Object.entries(c.styleMap ?? {})) {
    if (!VARIANTS.has(variant))
      throw new UsageError(`${path}: styleMap.${style} must be one of ${[...VARIANTS].join(", ")}`);
  }
  return c;
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (MARKDOWN.has(extname(entry.name).toLowerCase()))
        out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

function importMarkdown(
  root: string,
  files: string[],
  settings: BuildSettings,
  config: ProjectConfig,
): Loaded {
  const read = reader(root);
  const sources = files.map((path) => {
    const bytes = read(path);
    if (!bytes) throw new UsageError(`Markdown file not found: ${join(root, path)}`);
    return { path, text: new TextDecoder().decode(bytes) };
  });
  const result = fromMarkdown(sources, {
    ...pick(settings.title ?? config.title, "title"),
    ...pick(settings.language ?? config.language, "language"),
    ...pick(settings.authors ?? config.authors, "authors"),
    readFile: read,
  });
  const fingerprint = new TextEncoder().encode(JSON.stringify(sources));
  return { result, config, fingerprint };
}

function pick<K extends string, V>(value: V | undefined, key: K): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

/** Run Pandoc on a file and convert its JSON output. */
function importPandoc(file: string, settings: BuildSettings, config: ProjectConfig): Loaded {
  const media = mkdtempSync(join(tmpdir(), "flexova-media-"));
  try {
    const ext = extname(file).toLowerCase();
    const from =
      ext === ".docx" ? ["-f", "docx+styles"] : ext === ".odt" ? ["-f", "odt+styles"] : [];
    const run = spawnSync("pandoc", [...from, "-t", "json", `--extract-media=${media}`, file], {
      encoding: "utf8",
      maxBuffer: 1 << 30,
    });
    if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ToolError(
        `Converting ${ext || "this file"} needs Pandoc 2.11 or later: https://pandoc.org/installing.html (or use the flexova Docker image)`,
      );
    }
    if (run.status !== 0)
      throw new ToolError(`pandoc failed: ${(run.stderr || String(run.error)).trim()}`);
    const result = fromPandoc(JSON.parse(run.stdout), {
      ...pick(settings.title ?? config.title, "title"),
      ...pick(settings.language ?? config.language, "language"),
      ...pick(settings.authors ?? config.authors, "authors"),
      styleMap: { ...config.styleMap, ...settings.styleMap },
      readFile: (p) => {
        const full = resolve(p);
        return full.startsWith(resolve(media) + sep) ||
          full.startsWith(resolve(dirname(file)) + sep)
          ? readFileSync(full)
          : undefined;
      },
    });
    return { result, config, fingerprint: readFileSync(file) };
  } finally {
    rmSync(media, { recursive: true, force: true });
  }
}

/** Load any supported build input. */
export function load(input: string, settings: BuildSettings): Loaded {
  if (!existsSync(input)) throw new UsageError(`No such file or folder: ${input}`);
  if (statSync(input).isDirectory()) {
    const hasConfig = existsSync(join(input, CONFIG_FILE));
    const config = hasConfig ? readConfig(input) : {};
    const files = config.chapters ?? markdownFiles(input);
    if (!files.length)
      throw new UsageError(
        `${input} has no Markdown files (and no ${CONFIG_FILE} listing chapters)`,
      );
    return importMarkdown(input, files, settings, config);
  }
  if (MARKDOWN.has(extname(input).toLowerCase())) {
    return importMarkdown(dirname(input), [basename(input)], settings, {});
  }
  return importPandoc(input, settings, {});
}
