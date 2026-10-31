// fdoc-crypto.mjs — runs unchanged in browsers and Node >= 20. WebCrypto only, zero dependencies.
const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64 = (u8) => btoa(String.fromCharCode(...u8)); // small header fields only
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
// AAD = SHA-256(header bytes) || entry path. Binds every entry to this header and to its own path.
const aad = (headerHash, path) => concat(headerHash, te.encode(path));

const ITER = 600_000;                 // PBKDF2-SHA256 floor (OWASP)
const ITER_MIN = 100_000, ITER_MAX = 5_000_000; // reject weakened or DoS headers

async function passphraseKek(pass, salt, iterations, usages) {
  const base = await subtle.importKey("raw", te.encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base, { name: "AES-KW", length: 256 }, false, usages);
}

// BUILD SIDE: one random CEK per document revision; CEK wrapped once per recipient.
export async function seal(entries /* Map<path, Uint8Array> */, passphrase, docId) {
  const cek = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const salt = rand(16);
  const kek = await passphraseKek(passphrase, salt, ITER, ["wrapKey"]);
  const header = {
    fdoc: "1.0", docId, enc: "A256GCM",
    recipients: [{
      type: "passphrase", kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(salt),
      wrappedKey: b64(new Uint8Array(await subtle.wrapKey("raw", cek, kek, "AES-KW"))),
    }],
  };
  const headerBytes = te.encode(JSON.stringify(header)); // stored verbatim, never re-serialized
  const headerHash = new Uint8Array(await subtle.digest("SHA-256", headerBytes));
  const sealed = new Map();
  for (const [path, bytes] of entries) {
    const iv = rand(12);
    const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(headerHash, path) }, cek, bytes);
    sealed.set(path, concat(iv, new Uint8Array(ct))); // iv || ciphertext || 16-byte GCM tag
  }
  return { headerBytes, sealed };
}

// READ SIDE (the loader): unwrap CEK as NON-extractable, then decrypt entries lazily.
export async function unlock(headerBytes, passphrase) {
  const header = JSON.parse(new TextDecoder().decode(headerBytes));
  const r = header.recipients.find((x) => x.type === "passphrase");
  if (!r || r.iter < ITER_MIN || r.iter > ITER_MAX) throw new Error("unsupported header");
  const kek = await passphraseKek(passphrase, unb64(r.salt), r.iter, ["unwrapKey"]);
  const cek = await subtle.unwrapKey("raw", unb64(r.wrappedKey), kek, "AES-KW",
    { name: "AES-GCM" }, false, ["decrypt"]); // AES-KW integrity check -> throws on wrong passphrase
  const headerHash = new Uint8Array(await subtle.digest("SHA-256", headerBytes));
  return async (path, blob) => new Uint8Array(await subtle.decrypt(
    { name: "AES-GCM", iv: blob.subarray(0, 12), additionalData: aad(headerHash, path) }, cek, blob.subarray(12)));
}
