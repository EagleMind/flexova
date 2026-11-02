// Signatures: the shared signature fixtures, round trips, and interoperability with the Python package.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FlexovaError,
  generateSigningKey,
  jwkThumbprint,
  sign,
  unpack,
  validate,
  verify,
  write,
} from "./index.js";

const root = new URL("../../../", import.meta.url);
const suite = new URL("conformance/signatures/", root);
const expected = JSON.parse(readFileSync(new URL("expected.json", suite), "utf8")) as {
  trustedKeys: string;
  fixtures: Record<string, { code: string | null }>;
};
const trusted = JSON.parse(readFileSync(new URL(expected.trustedKeys, suite), "utf8"));
const spec = JSON.parse(readFileSync(new URL("spec/signature.json", root), "utf8"));

const doc = () =>
  write({
    identifier: "urn:uuid:7d1c9f40-1b7a-4c51-9a2e-000000000002",
    title: "Signed",
    language: "en",
    modified: "2026-11-02T00:00:00Z",
    chapters: [{ title: "One", body: '<section><h1 id="a">One</h1><p>Text.</p></section>' }],
  });

describe("signature conformance suite", () => {
  it("covers every code and a valid signature", () => {
    const codes = new Set(Object.values(expected.fixtures).map((f) => f.code));
    expect([...codes].filter(Boolean).sort()).toEqual(Object.keys(spec.codes).sort());
    expect(codes.has(null)).toBe(true);
  });

  it.each(Object.entries(expected.fixtures))("%s", async (rel, want) => {
    const result = await verify(readFileSync(new URL(`../${rel}`, suite)), trusted);
    expect(result.code).toBe(want.code);
    expect(result.ok).toBe(want.code === null);
  });
});

describe("sign()", () => {
  it("round-trips and detects tampering", async () => {
    const { privateJwk, publicJwk } = await generateSigningKey();
    expect(publicJwk).not.toHaveProperty("d");
    expect(publicJwk.kid).toBe(await jwkThumbprint(publicJwk));
    const signed = await sign(await doc(), privateJwk);
    expect((await validate(signed)).valid).toBe(true);
    const ok = await verify(signed, { keys: [publicJwk] });
    expect(ok).toMatchObject({ ok: true, code: null, kid: publicJwk.kid });
    const other = (await generateSigningKey()).publicJwk;
    expect((await verify(signed, [{ ...other, kid: publicJwk.kid }])).code).toBe("SIG_INVALID");
    expect((await verify(await doc(), [publicJwk])).code).toBe("SIG_MISSING");
    expect((await verify(signed, [])).code).toBe("SIG_UNKNOWN_KEY");
  });

  it("is deterministic and replaces an earlier signature", async () => {
    const a = await generateSigningKey("k1");
    const b = await generateSigningKey("k2");
    const once = await sign(await doc(), a.privateJwk, { iat: 1793491200 });
    expect(once).toEqual(await sign(await doc(), a.privateJwk, { iat: 1793491200 }));
    const twice = await sign(once, b.privateJwk);
    expect((await verify(twice, [a.publicJwk])).code).toBe("SIG_UNKNOWN_KEY");
    expect((await verify(twice, [a.publicJwk, b.publicJwk])).ok).toBe(true);
  });

  it("refuses invalid packages and keys", async () => {
    const { privateJwk, publicJwk } = await generateSigningKey();
    await expect(sign(new Uint8Array([1, 2, 3]), privateJwk)).rejects.toBeInstanceOf(FlexovaError);
    await expect(sign(await doc(), publicJwk)).rejects.toBeInstanceOf(TypeError);
    const mismatched = { ...privateJwk, x: (await generateSigningKey()).publicJwk.x };
    await expect(sign(await doc(), mismatched)).rejects.toThrow(/does not match/);
  });

  it("interoperates with the Python implementation, byte for byte", async () => {
    const { privateJwk, publicJwk } = await generateSigningKey("interop");
    const dir = mkdtempSync(join(tmpdir(), "flexova-sig-"));
    const signed = await sign(await doc(), privateJwk, { iat: 1793491200 });
    writeFileSync(join(dir, "ts.flexova"), signed);
    writeFileSync(join(dir, "doc.flexova"), await doc());
    writeFileSync(join(dir, "key.json"), JSON.stringify(privateJwk));
    const script = [
      "import json, sys, flexova",
      "d = sys.argv[1]",
      "key = json.load(open(d + '/key.json'))",
      "public = {k: v for k, v in key.items() if k != 'd'}",
      "print(flexova.verify(open(d + '/ts.flexova', 'rb').read(), [public]).code)",
      "open(d + '/py.flexova', 'wb').write(flexova.sign(open(d + '/doc.flexova', 'rb').read(), key, iat=1793491200))",
    ].join("\n");
    const out = execFileSync("python3", ["-c", script, dir], {
      env: { ...process.env, PYTHONPATH: new URL("python/src", root).pathname },
      encoding: "utf8",
    });
    expect(out.trim()).toBe("None");
    const fromPython = readFileSync(join(dir, "py.flexova"));
    expect((await verify(fromPython, [publicJwk])).ok).toBe(true);
    const sigOf = (b: Uint8Array) => new TextDecoder().decode(unpack(b).get(spec.path));
    expect(sigOf(fromPython)).toBe(sigOf(signed));
  });
});
