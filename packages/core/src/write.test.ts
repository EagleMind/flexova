import { describe, expect, it } from "vitest";
import { FlexovaError, validate, write, type WriteInput } from "./index.js";

const svg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
);
const sample = (overrides: Partial<WriteInput> = {}): WriteInput => ({
  identifier: "urn:uuid:3f1c2b7e-0000-4000-8000-000000000001",
  title: "Field Service Manual",
  language: "en",
  modified: "2026-11-02T00:00:00Z",
  authors: ["EagleMind"],
  tokens: { color: { accent: { light: "#0b5fff", dark: "#7aa7ff" } }, measure: 70 },
  chapters: [
    {
      title: "Before you start",
      body: '<section id="s1"><h1 id="h1">Before you start</h1><p>Isolate the unit. See <a href="02.xhtml#specs">specifications</a>.</p></section>',
    },
    {
      title: "Specifications",
      body:
        '<section id="specs"><h1 id="h2">Specifications</h1><figure id="f1"><img src="../assets/chart.svg" alt="Bar chart" width="10" height="10"/></figure>' +
        '<p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>=</mo><mn>2</mn></math></p></section>',
    },
  ],
  assets: [{ path: "assets/chart.svg", mediaType: "image/svg+xml", data: svg }],
  ...overrides,
});

const sha = async (b: Uint8Array) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>)).toString("hex");

describe("write()", () => {
  it("produces a valid package, byte-identical across builds", async () => {
    const [a, b] = [await write(sample()), await write(sample())];
    expect(await sha(a)).toBe(await sha(b));
    const report = await validate(a);
    expect(report.codes).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it("refuses to emit an invalid package", async () => {
    const err = await write(
      sample({ chapters: [{ title: "x", body: "<div><p>not in the profile</p></div>" }] }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(FlexovaError);
    expect((err as FlexovaError).report.codes).toContain("PRF_UNKNOWN_ELEMENT");
  });

  it("rejects malformed input", async () => {
    await expect(write(sample({ title: "" }))).rejects.toThrow(TypeError);
    await expect(write(sample({ chapters: [] }))).rejects.toThrow(TypeError);
    await expect(
      write(
        sample({ assets: [{ path: "nav.xhtml", mediaType: "image/png", data: new Uint8Array() }] }),
      ),
    ).rejects.toThrow(TypeError);
  });

  it("supports right-to-left documents and a custom nav title", async () => {
    const pkg = await write(sample({ language: "ar", direction: "rtl", navTitle: "المحتويات" }));
    expect((await validate(pkg)).valid).toBe(true);
  });
});
