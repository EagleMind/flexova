import { FlexovaError, read, sha256 } from "@flexova/core";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromHtml, toBase64, toHtml } from "./index.js";

const conformance = new URL("../../../conformance/", import.meta.url);
const expected = JSON.parse(readFileSync(new URL("expected.json", conformance), "utf8"))
  .fixtures as Record<string, { valid: boolean }>;
const valid = Object.keys(expected).filter((k) => expected[k]?.valid);
const fixture = (rel: string) => new Uint8Array(readFileSync(new URL(rel, conformance)));

describe("toHtml()", () => {
  it.each(valid)("%s renders to a static page with no scripts and no remote loads", async (rel) => {
    const { html } = await toHtml(fixture(rel));
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts).toEqual([
      '<script type="application/vnd.flexova.package+json" id="flexova-package">',
    ]);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/\s(src|srcset)="(https?:)?\/\//);
    expect(html).toMatch(
      /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; /,
    );
  });

  it.each(valid)(
    "%s round-trips: fromHtml recovers every original entry byte for byte",
    async (rel) => {
      const original = await read(fixture(rel));
      const recovered = await read(fromHtml((await toHtml(fixture(rel))).html));
      expect([...recovered.entries.keys()].sort()).toEqual([...original.entries.keys()].sort());
      for (const [name, bytes] of original.entries)
        expect(recovered.entries.get(name), name).toEqual(bytes);
    },
  );

  it("is deterministic", async () => {
    expect((await toHtml(fixture("valid/images.flexova"))).html).toBe(
      (await toHtml(fixture("valid/images.flexova"))).html,
    );
  });

  it("pins the stylesheet in the CSP by hash", async () => {
    const { html } = await toHtml(fixture("valid/tokens-full.flexova"));
    const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] as string;
    const hash = toBase64(await sha256(new TextEncoder().encode(css)));
    expect(html).toContain(`style-src 'sha256-${hash}'`);
    expect(css).toContain("--flexova-brand:#8a2be2");
  });

  it("rewrites links into in-page anchors and inlines images as data: URIs", async () => {
    const { html } = await toHtml(fixture("valid/links.flexova"));
    expect(html).toContain('href="#d2-b-detail"');
    expect(html).toContain('<a href="#d1-a-end">');
    expect(html).toContain('<a href="mailto:docs@example.org" rel="noopener noreferrer">');
    const images = await toHtml(fixture("valid/images.flexova"));
    expect(images.html).toMatch(
      /<img src="data:image\/jpeg;base64,[^"]+" data-flexova-src="OEBPS\/assets\/photo.jpg"/,
    );
    expect(images.html).toMatch(
      /<source srcset="data:image\/svg\+xml;base64,[^"]+" data-flexova-src="OEBPS\/assets\/chart-dark.svg"/,
    );
  });

  it("carries the document language and direction", async () => {
    const { html } = await toHtml(fixture("valid/right-to-left.flexova"));
    expect(html).toMatch(/<html lang="ar" dir="rtl">/);
  });

  it("warns above the soft size limit", async () => {
    const { warnings } = await toHtml(fixture("valid/images.flexova"), { softLimitBytes: 1000 });
    expect(warnings[0]).toMatch(/soft limit/);
  });

  it("refuses invalid packages", async () => {
    await expect(toHtml(fixture("hostile/script-element.flexova"))).rejects.toBeInstanceOf(
      FlexovaError,
    );
  });
});

describe("fromHtml()", () => {
  it("rejects pages without an embedded package or with one that is incomplete", async () => {
    expect(() => fromHtml("<!doctype html><p>hi</p>")).toThrow(/does not embed/);
    const { html } = await toHtml(fixture("valid/images.flexova"));
    expect(() =>
      fromHtml(html.replace(/data-flexova-src="OEBPS\/assets\/photo.jpg"/g, "")),
    ).toThrow(/incomplete/);
  });
});
