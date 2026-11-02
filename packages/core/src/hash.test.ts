import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex, sha256Sync } from "./hash.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const utf8 = (s: string) => new TextEncoder().encode(s);

describe("pure-JS SHA-256 fallback", () => {
  it("matches the NIST FIPS 180-2 test vectors", () => {
    expect(hex(sha256Sync(utf8("")))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(hex(sha256Sync(utf8("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hex(sha256Sync(utf8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("matches node:crypto at every padding boundary and on a large buffer", () => {
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1000]) {
      const data = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff);
      expect(hex(sha256Sync(data)), `length ${n}`).toBe(
        createHash("sha256").update(data).digest("hex"),
      );
    }
    const big = new Uint8Array(3_000_000).map((_, i) => (i * 7) & 0xff);
    expect(hex(sha256Sync(big))).toBe(createHash("sha256").update(big).digest("hex"));
  });

  it("sha256Hex agrees whether or not WebCrypto is used", async () => {
    const data = utf8("Flexova");
    expect(await sha256Hex(data)).toBe(hex(sha256Sync(data)));
  });
});
