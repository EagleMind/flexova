import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlexovaError, pack, read, validate } from "./index.js";

const fixture = (rel: string) =>
  readFileSync(new URL(`../../../conformance/${rel}`, import.meta.url));

describe("read()", () => {
  it("opens a valid package with its reading order, metadata and tokens", async () => {
    const pkg = await read(fixture("valid/links.flexova"));
    expect(pkg.spine).toEqual([
      "OEBPS/content/01.xhtml",
      "OEBPS/content/02.xhtml",
      "OEBPS/content/03.xhtml",
    ]);
    expect(pkg.navPath).toBe("OEBPS/nav.xhtml");
    expect(pkg.title).toBe("Flexova conformance fixture");
    expect(pkg.language).toBe("en");
    expect(pkg.tokens?.color?.accent?.light).toBe("#0b5fff");
    expect(pkg.report.valid).toBe(true);
  });

  it("keeps warnings in the report", async () => {
    const pkg = await read(fixture("valid/warning-heading-skip.flexova"));
    expect(pkg.report.codes).toEqual(["PRF_HEADING_SKIP"]);
  });

  it("refuses invalid packages", async () => {
    await expect(read(fixture("hostile/script-element.flexova"))).rejects.toBeInstanceOf(
      FlexovaError,
    );
  });
});

describe("pack()", () => {
  it("re-packs entries into an equivalent, deterministic, valid package", async () => {
    const pkg = await read(fixture("valid/images.flexova"));
    const repacked = pack(pkg.entries);
    expect(pack(pkg.entries)).toEqual(repacked);
    expect((await validate(repacked)).valid).toBe(true);
    const again = await read(repacked);
    expect([...again.entries.keys()].sort()).toEqual([...pkg.entries.keys()].sort());
    for (const [name, data] of pkg.entries) expect(again.entries.get(name)).toEqual(data);
  });
});
