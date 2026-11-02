import { compileTokens, read } from "@flexova/core";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generate } from "../scripts/gen-allowlist.mjs";
import { themeVars } from "./style.js";
import { ViewerError, unzip } from "./zip.js";

const conformance = new URL("../../../conformance/", import.meta.url);
const fixture = (rel: string) => new Uint8Array(readFileSync(new URL(rel, conformance)));

describe("generated allowlist", () => {
  it("is up to date with spec/profile (run `pnpm --filter @flexova/viewer gen`)", () => {
    expect(readFileSync(new URL("./allowlist.ts", import.meta.url), "utf8")).toBe(generate());
  });
});

describe("theme variables", () => {
  const vectors = JSON.parse(
    readFileSync(new URL("vectors/compile-tokens.json", conformance), "utf8"),
  ).cases as {
    name: string;
    tokens: unknown;
  }[];
  it.each(vectors.map((v) => [v.name, v.tokens] as const))(
    "match core compileTokens() for %s",
    (_name, tokens) => {
      const css = compileTokens(tokens);
      const root = /:root\{color-scheme:light dark;(.*?)\}/.exec(css)?.[1] ?? "";
      const dark = /@media \(prefers-color-scheme:dark\)\{:root\{(.*?)\}\}/.exec(css)?.[1] ?? "";
      const [light, darkVars, fonts] = themeVars(tokens);
      expect(light + fonts).toBe(root + ";");
      expect(darkVars).toBe(dark + ";");
    },
  );
});

describe("unzip()", () => {
  it("reads the same entries as @flexova/core", async () => {
    for (const rel of [
      "valid/images.flexova",
      "valid/data-descriptors.flexova",
      "valid/deflate-trailing-bytes.flexova",
    ]) {
      const data = fixture(rel);
      const pkg = await read(data);
      const readEntry = unzip(data);
      for (const [name, bytes] of pkg.entries)
        expect(await readEntry(name), `${rel} ${name}`).toEqual(bytes);
    }
  });

  it.each([
    ["hostile/zip-bomb.flexova", "TOO_LARGE"],
    ["hostile/entry-count-bomb.flexova", "TOO_LARGE"],
    ["hostile/declared-size-overflow.flexova", "TOO_LARGE"],
    ["invalid/not-a-zip.flexova", "NOT_A_PACKAGE"],
    ["invalid/zip64.flexova", "NOT_A_PACKAGE"],
  ])("refuses %s (%s)", (rel, code) => {
    expect(() => unzip(fixture(rel))).toThrow(ViewerError);
    try {
      unzip(fixture(rel));
    } catch (e) {
      expect((e as ViewerError).code).toBe(code);
    }
  });

  it("never returns more bytes than declared", async () => {
    const readEntry = unzip(fixture("hostile/declared-size-lie.flexova"));
    expect(await readEntry("OEBPS/content/01.xhtml")).toBeNull();
  });
});
