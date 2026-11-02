// The CLI, run in-process through main() (plus one run of the built binary).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pack, unpack, validate } from "@flexova/core";
import { beforeEach, describe, expect, it } from "vitest";
import { EXIT, main, VERSION } from "./main.js";

const root = new URL("../../../", import.meta.url).pathname;
const manual = join(root, "samples/markdown-manual");
const docx = join(root, "samples/docx/field-guide.docx");
let dir = "";

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const code = await main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) });
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    process.chdir(cwd);
  }
}

const hasPandoc = (() => {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flexova-cli-"));
});

describe("flexova", () => {
  it("prints help and version, and rejects unknown commands and options", async () => {
    expect((await run()).code).toBe(EXIT.usage);
    expect((await run("--help")).out).toContain("Usage: flexova <command>");
    expect((await run("--version")).out).toBe(VERSION);
    expect((await run("frobnicate")).code).toBe(EXIT.usage);
    const bad = await run("check", "--nope", "x");
    expect(bad.code).toBe(EXIT.usage);
    expect(bad.err).toContain("Usage: flexova check");
    expect((await run("build", "--help")).out).toContain("Usage: flexova build");
  });

  it("builds the sample manual reproducibly, with a static HTML copy", async () => {
    const a = await run("build", manual, "-o", "a.flexova", "--html");
    expect(a.code, a.err).toBe(EXIT.ok);
    expect(a.err).not.toContain("warning");
    const bytes = readFileSync(join(dir, "a.flexova"));
    expect((await validate(bytes)).codes).toEqual([]);
    expect(readFileSync(join(dir, "a.flexova.html"), "utf8")).toContain(
      "<title>Aurora P2 Field Manual</title>",
    );
    await run("build", manual, "-o", "b.flexova");
    expect(readFileSync(join(dir, "b.flexova"))).toEqual(bytes);
  });

  it("builds a single Markdown file and honours --strict", async () => {
    writeFileSync(join(dir, "note.md"), "# Note\n\n![](missing.png)\n");
    const loose = await run(
      "build",
      "note.md",
      "--lang",
      "en",
      "--modified",
      "2026-11-02T00:00:00Z",
    );
    expect(loose.code).toBe(EXIT.ok);
    expect(loose.err).toContain("warning: Image not found: missing.png");
    expect(existsSync(join(dir, "note.flexova"))).toBe(true);
    const strict = await run(
      "build",
      "note.md",
      "--lang",
      "en",
      "--strict",
      "-o",
      "strict.flexova",
    );
    expect(strict.code).toBe(EXIT.failed);
    expect(existsSync(join(dir, "strict.flexova"))).toBe(false);
  });

  it("starts a project with new and builds it", async () => {
    expect((await run("new", "proj", "--title", "Proj")).code).toBe(EXIT.ok);
    expect((await run("new", "proj")).code).toBe(EXIT.usage);
    expect((await run("build", "proj")).code).toBe(EXIT.ok);
    const check = await run("check", "proj.flexova");
    expect([check.code, check.out]).toEqual([EXIT.ok, "valid    proj.flexova"]);
  });

  it.skipIf(!hasPandoc)("builds a DOCX through Pandoc, mapping a custom style", async () => {
    const r = await run(
      "build",
      docx,
      "--lang",
      "en-GB",
      "--style",
      "First Paragraph=important",
      "-o",
      "g.flexova",
    );
    expect(r.code, r.err).toBe(EXIT.ok);
    const info = JSON.parse((await run("inspect", "g.flexova", "--json")).out);
    expect(info).toMatchObject({
      title: "Aurora P2 Quick Reference",
      language: "en-GB",
      signature: null,
    });
    expect(info.chapters).toHaveLength(2);
    expect(info.assets).toHaveLength(1);
    const body = new TextDecoder().decode(
      unpack(readFileSync(join(dir, "g.flexova"))).get("OEBPS/content/01.xhtml"),
    );
    expect(body).toContain('data-flexova-variant="important"');
    expect((await run("build", docx, "--style", "Nope")).code).toBe(EXIT.usage);
  });

  it("reports invalid packages with codes, as text or JSON", async () => {
    const bad = join(root, "conformance/hostile/script-element.flexova");
    const good = join(root, "conformance/valid/minimal.flexova");
    const text = await run("check", good, bad);
    expect(text.code).toBe(EXIT.failed);
    expect(text.out).toContain("INVALID");
    expect(text.out).toContain("PRF_FORBIDDEN_ELEMENT");
    const json = JSON.parse((await run("check", bad, "--json")).out);
    expect(json[0].valid).toBe(false);
    expect((await run("inspect", bad)).code).toBe(EXIT.failed);
    expect((await run("check", "missing.flexova")).code).toBe(EXIT.usage);
  });

  it("keygen, sign and verify, and detects tampering", async () => {
    await run("build", manual, "-o", "m.flexova");
    expect((await run("keygen", "team", "--kid", "team-2026")).code).toBe(EXIT.ok);
    expect(statSync(join(dir, "team.private.jwk.json")).mode & 0o777).toBe(0o600);
    expect((await run("keygen", "team")).code).toBe(EXIT.usage);
    expect(
      (await run("sign", "m.flexova", "--key", "team.private.jwk.json", "-o", "s.flexova")).code,
    ).toBe(EXIT.ok);
    const ok = await run("verify", "s.flexova", "--keys", "team.jwks.json");
    expect([ok.code, ok.out]).toEqual([EXIT.ok, "verified  s.flexova  (key team-2026)"]);
    expect((await run("inspect", "s.flexova")).out).toContain(
      "Signature: present (kid team-2026, alg Ed25519)",
    );
    expect((await run("verify", "m.flexova", "--keys", "team.jwks.json")).out).toContain(
      "SIG_MISSING",
    );

    const entries = unpack(readFileSync(join(dir, "s.flexova")));
    entries.set("OEBPS/content/01.xhtml", new TextEncoder().encode("tampered"));
    writeFileSync(join(dir, "t.flexova"), pack(entries));
    const tampered = await run("verify", "t.flexova", "--keys", "team.jwks.json", "--json");
    expect(tampered.code).toBe(EXIT.failed);
    expect(JSON.parse(tampered.out)).toMatchObject({ ok: false, code: "SIG_PACKAGE_INVALID" });
    expect((await run("sign", "m.flexova", "--key", "team.jwks.json")).code).toBe(EXIT.usage);
  });

  it("builds and signs in one step", async () => {
    await run("keygen", "k");
    expect(
      (await run("build", manual, "-o", "x.flexova", "--sign", "k.private.jwk.json")).code,
    ).toBe(EXIT.ok);
    expect((await run("verify", "x.flexova", "--keys", "k.jwks.json")).code).toBe(EXIT.ok);
  });

  it("round-trips through pack --html, unpack and pack", async () => {
    await run("build", manual, "-o", "m.flexova");
    expect((await run("pack", "--html", "m.flexova")).code).toBe(EXIT.ok);
    expect((await run("unpack", "m.flexova.html", "-o", "fromhtml")).code).toBe(EXIT.ok);
    expect((await run("unpack", "m.flexova", "-o", "fromzip")).code).toBe(EXIT.ok);
    expect((await run("unpack", "m.flexova", "-o", "fromzip")).code).toBe(EXIT.usage);
    expect(readFileSync(join(dir, "fromhtml/OEBPS/assets/panel.png"))).toEqual(
      readFileSync(join(manual, "images/panel.png")),
    );
    expect((await run("pack", "fromhtml", "-o", "repacked.flexova")).code).toBe(EXIT.ok);
    const original = unpack(readFileSync(join(dir, "m.flexova")));
    const repacked = unpack(readFileSync(join(dir, "repacked.flexova")));
    expect([...repacked.keys()].sort()).toEqual([...original.keys()].sort());
    for (const [k, v] of original) expect(repacked.get(k), k).toEqual(v);
  });

  it("exports EPUB and refuses invalid input", async () => {
    await run("build", manual, "-o", "m.flexova");
    expect((await run("export", "--epub", "m.flexova")).code).toBe(EXIT.ok);
    expect(readFileSync(join(dir, "m.epub"))).toEqual(readFileSync(join(dir, "m.flexova")));
    expect((await run("export", "m.flexova")).code).toBe(EXIT.usage);
    const bad = join(root, "conformance/hostile/script-element.flexova");
    expect((await run("export", "--epub", bad, "-o", "bad.epub")).code).toBe(EXIT.failed);
  });

  it("runs as an installed binary", () => {
    const bin = join(root, "packages/cli/dist/cli.js");
    const r = spawnSync(
      process.execPath,
      [bin, "check", join(root, "conformance/valid/minimal.flexova")],
      {
        encoding: "utf8",
      },
    );
    expect([r.status, r.stdout.trim()]).toEqual([
      0,
      `valid    ${join(root, "conformance/valid/minimal.flexova")}`,
    ]);
  });
});
