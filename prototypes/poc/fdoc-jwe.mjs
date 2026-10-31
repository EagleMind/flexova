// fdoc-jwe.mjs — standards-based key envelope (RFC 7516 JWE, General/Flattened JSON) + per-entry AES-GCM.
// WebCrypto only; identical in browsers and Node >= 20. Implements a deliberately tiny JWE subset:
//   enc: A256GCM   alg: PBES2-HS512+A256KW | ECDH-ES+A256KW (P-256)   — everything else is refused.
const subtle = globalThis.crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0;
  for (const x of p) { o.set(x, i); i += x.length; } return o; };
const u32 = (n) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
export const b64u = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

const PBES2 = "PBES2-HS512+A256KW", ECDH = "ECDH-ES+A256KW";
export const P2C_DEFAULT = 600_000, P2C_MIN = 100_000, P2C_MAX = 2_000_000; // floor stops downgrades, cap stops DoS

async function pbes2Kek(pass, p2s, p2c, usage) {
  if (!Number.isInteger(p2c) || p2c < P2C_MIN || p2c > P2C_MAX) throw new Error("p2c out of bounds");
  const base = await subtle.importKey("raw", te.encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  const salt = concat(te.encode(PBES2), new Uint8Array([0]), p2s);                  // RFC 7518 §4.8.1.1
  return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-512", salt, iterations: p2c }, base,
    { name: "AES-KW", length: 256 }, false, [usage]);
}
async function ecdhKek(myPrivate, theirPublic, apu, apv, usage) {                     // RFC 7518 §4.6 Concat KDF
  const z = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: theirPublic }, myPrivate, 256));
  const lp = (b) => concat(u32(b.length), b);
  const otherInfo = concat(lp(te.encode(ECDH)), lp(apu), lp(apv), u32(256));
  const k = await subtle.digest("SHA-256", concat(u32(1), z, otherInfo));
  return subtle.importKey("raw", k, "AES-KW", false, [usage]);
}
const importEcPublic = (jwk) => subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
  { name: "ECDH", namedCurve: "P-256" }, false, []);                                  // import validates the point

// ---- BUILD SIDE ---------------------------------------------------------------------------------
// recipients: [{ type: "passphrase", passphrase, kid, p2c? } | { type: "ecdh", publicJwk, kid }]
export async function sealKeyring(keyring, recipients) {
  const cek = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const out = [];
  for (const r of recipients) {
    if (r.type === "passphrase") {
      const p2s = rand(16), p2c = r.p2c ?? P2C_DEFAULT;
      const kek = await pbes2Kek(r.passphrase, p2s, p2c, "wrapKey");
      out.push({ header: { alg: PBES2, kid: r.kid, p2s: b64u(p2s), p2c },
        encrypted_key: b64u(new Uint8Array(await subtle.wrapKey("raw", cek, kek, "AES-KW"))) });
    } else if (r.type === "ecdh") {
      const eph = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const kek = await ecdhKek(eph.privateKey, await importEcPublic(r.publicJwk), new Uint8Array(), new Uint8Array(), "wrapKey");
      const { kty, crv, x, y } = await subtle.exportKey("jwk", eph.publicKey);
      out.push({ header: { alg: ECDH, kid: r.kid, epk: { kty, crv, x, y } },
        encrypted_key: b64u(new Uint8Array(await subtle.wrapKey("raw", cek, kek, "AES-KW"))) });
    } else throw new Error("unknown recipient type");
  }
  const protectedB64 = b64u(te.encode(JSON.stringify({ enc: "A256GCM", cty: "application/vnd.flowdoc.keyring+json" })));
  const iv = rand(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(protectedB64) },
    cek, te.encode(JSON.stringify(keyring))));
  return { protected: protectedB64, recipients: out, iv: b64u(iv),
    ciphertext: b64u(ct.subarray(0, -16)), tag: b64u(ct.subarray(-16)) };
}

// ---- READ SIDE ----------------------------------------------------------------------------------
// unlockWith: { passphrase } | { privateKey: CryptoKey (ECDH P-256), kid? }
export async function openKeyring(jwe, unlockWith) {
  const prot = JSON.parse(td.decode(unb64u(jwe.protected)));
  if (prot.enc !== "A256GCM" || "zip" in prot || "crit" in prot || "aad" in jwe) throw new Error("unsupported JWE");
  const recipients = jwe.recipients ?? [{ header: jwe.header, encrypted_key: jwe.encrypted_key }]; // General or Flattened
  for (const r of recipients) {
    const h = { ...jwe.unprotected, ...r.header, ...prot };
    let kek;
    if (h.alg === PBES2 && unlockWith.passphrase !== undefined) kek = await pbes2Kek(unlockWith.passphrase, unb64u(h.p2s), h.p2c, "unwrapKey");
    else if (h.alg === ECDH && unlockWith.privateKey && (!unlockWith.kid || unlockWith.kid === h.kid))
      kek = await ecdhKek(unlockWith.privateKey, await importEcPublic(h.epk), unb64u(h.apu ?? ""), unb64u(h.apv ?? ""), "unwrapKey");
    else continue;                                                                     // alg allowlist: skip anything else
    let cek;
    try { cek = await subtle.unwrapKey("raw", unb64u(r.encrypted_key), kek, "AES-KW", { name: "AES-GCM" }, false, ["decrypt"]); }
    catch { continue; }                                                                // wrong secret for this recipient
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64u(jwe.iv), additionalData: te.encode(jwe.protected) },
      cek, concat(unb64u(jwe.ciphertext), unb64u(jwe.tag)));
    return JSON.parse(td.decode(pt));
  }
  throw new Error("no recipient could be unlocked");
}

// ---- ENTRIES: one data key (DEK) per revision, carried inside the keyring -----------------------
export const newDek = () => rand(32);
const dekKey = (raw, usage) => subtle.importKey("raw", raw, "AES-GCM", false, [usage]);
export async function sealEntry(dekRaw, path, bytes) {
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(path) }, await dekKey(dekRaw, "encrypt"), bytes);
  return concat(iv, new Uint8Array(ct));                                              // iv ‖ ciphertext ‖ tag
}
export async function entryOpener(dekB64u) {
  const key = await dekKey(unb64u(dekB64u), "decrypt");                               // non-extractable from here on
  return async (path, blob) => new Uint8Array(await subtle.decrypt(
    { name: "AES-GCM", iv: blob.subarray(0, 12), additionalData: te.encode(path) }, key, blob.subarray(12)));
}
