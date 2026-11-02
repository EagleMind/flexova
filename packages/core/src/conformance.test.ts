// The shared conformance suite: this implementation must report exactly the expected codes per fixture.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileTokens, validate } from "./index.js";

const root = new URL("../../../", import.meta.url);
const suite = new URL("conformance/", root);
const expected = JSON.parse(readFileSync(new URL("expected.json", suite), "utf8"))
  .fixtures as Record<string, { valid: boolean; codes: string[] }>;

describe("conformance suite", () => {
  it("is large enough", () => {
    const count = (c: string) => Object.keys(expected).filter((k) => k.startsWith(`${c}/`)).length;
    expect(count("valid")).toBeGreaterThanOrEqual(15);
    expect(count("invalid")).toBeGreaterThanOrEqual(25);
    expect(count("hostile")).toBeGreaterThanOrEqual(10);
  });

  it.each(Object.entries(expected))("%s", async (rel, want) => {
    const report = await validate(readFileSync(new URL(rel, suite)));
    expect(
      { codes: report.codes, valid: report.valid },
      report.issues.map((i) => `${i.code} ${i.path}: ${i.message}`).join("\n"),
    ).toEqual({
      codes: want.codes,
      valid: want.valid,
    });
  });
});

describe("compileTokens golden vectors", () => {
  const vectors = JSON.parse(readFileSync(new URL("vectors/compile-tokens.json", suite), "utf8"))
    .cases as {
    name: string;
    tokens: unknown;
    css: string;
  }[];
  it.each(vectors.map((v) => [v.name, v] as const))("%s", (_name, v) => {
    expect(compileTokens(v.tokens)).toBe(v.css);
  });
});

describe("bundled spec data", () => {
  it.each(["constants.json", "errors.json", "profile-1.0.json", "signature.json"])(
    "%s matches spec/ (run `pnpm sync:spec`)",
    (name) => {
      const source = name.startsWith("profile") ? `spec/profile/${name}` : `spec/${name}`;
      expect(
        readFileSync(new URL(`src/spec/${name}`, new URL("../", import.meta.url)), "utf8"),
      ).toBe(readFileSync(new URL(source, root), "utf8"));
    },
  );
});
