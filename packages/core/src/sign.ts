// Flexova signatures (spec section 11; rules in spec/signature.json): a detached compact JWS, signed with
// Ed25519 over the exact bytes of META-INF/flexova.json. The manifest lists every entry's SHA-256, so the
// signature covers the whole package. Uses WebCrypto's Ed25519 (Node 22+, current browsers).
import { sha256 } from "./hash.js";
import { pack, unpack } from "./read.js";
import { FlexovaError, type Report } from "./report.js";
import { SIGNATURE } from "./spec.js";
import { validate } from "./validate.js";

export type SignatureCode =
  | "SIG_PACKAGE_INVALID"
  | "SIG_MISSING"
  | "SIG_MALFORMED"
  | "SIG_ALGORITHM"
  | "SIG_UNKNOWN_KEY"
  | "SIG_INVALID";

/** The outcome of verify(): ok with code null, or the first failing check's code. */
export interface Verification {
  ok: boolean;
  code: SignatureCode | null;
  message: string;
  /** The signature's key ID, once the header could be read. */
  kid: string | null;
  /** The package's validation report. */
  report: Report;
}

/** An Ed25519 key as a JSON Web Key (RFC 8037). Private keys also carry `d`. */
export interface Ed25519Jwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  d?: string;
  kid?: string;
  use?: string;
  alg?: string;
}

/** Trusted public keys: a JWKS (`{ keys: [...] }`) or an array of JWKs. Unusable keys are skipped. */
export type TrustedKeys = { keys: readonly unknown[] } | readonly unknown[];

export interface SignOptions {
  /** Key ID for the header; defaults to the key's `kid`, then its RFC 7638 thumbprint. */
  kid?: string;
  /** Signing time in seconds since the epoch. Omitted by default, so signing is deterministic. */
  iat?: number;
}

const ED25519 = { name: "Ed25519" };
const SEGMENT = /^[A-Za-z0-9_-]*$/;
// PKCS #8 prefix for a raw 32-byte Ed25519 private key (RFC 8410).
const PKCS8_PREFIX = [
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
];
const utf8 = (s: string) => new TextEncoder().encode(s);
const buffer = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

function b64u(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64u(text: string): Uint8Array | null {
  if (!SEGMENT.test(text) || text.length % 4 === 1) return null;
  const bin = atob(
    text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4),
  );
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) {
    throw new Error(
      "Flexova signatures need WebCrypto (crypto.subtle); browsers expose it only on secure (https) pages",
    );
  }
  return s;
}

/** RFC 7638 thumbprint of an Ed25519 key: the default key ID. */
export async function jwkThumbprint(jwk: Pick<Ed25519Jwk, "crv" | "kty" | "x">): Promise<string> {
  return b64u(await sha256(utf8(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }))));
}

/** Generate an Ed25519 signing key. Keep `privateJwk` secret; publish `publicJwk` in your JWKS. */
export async function generateSigningKey(
  kid?: string,
): Promise<{ privateJwk: Ed25519Jwk; publicJwk: Ed25519Jwk }> {
  const pair = (await subtle().generateKey(ED25519, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await subtle().exportKey("jwk", pair.privateKey);
  const base = { kty: "OKP", crv: "Ed25519", x: jwk.x as string } as const;
  const publicJwk: Ed25519Jwk = {
    ...base,
    kid: kid ?? (await jwkThumbprint(base)),
    use: "sig",
    alg: SIGNATURE.algorithms.sign,
  };
  return { privateJwk: { ...publicJwk, d: jwk.d as string }, publicJwk };
}

/**
 * Sign a valid package. Returns the package with META-INF/flexova.sig.jws added or replaced. Throws
 * FlexovaError if the package is invalid and TypeError if the key is not a private Ed25519 JWK.
 */
export async function sign(
  input: Uint8Array,
  privateJwk: Ed25519Jwk,
  options: SignOptions = {},
): Promise<Uint8Array> {
  const report = await validate(input);
  if (!report.valid) throw new FlexovaError(report);
  if (
    privateJwk?.kty !== "OKP" ||
    privateJwk.crv !== "Ed25519" ||
    typeof privateJwk.d !== "string"
  ) {
    throw new TypeError(
      "the signing key must be a private Ed25519 JWK (kty OKP, crv Ed25519, with d)",
    );
  }
  const seed = unb64u(privateJwk.d);
  if (!seed || seed.length !== 32)
    throw new TypeError("the signing key's d is not a 32-byte base64url value");
  const der = new Uint8Array([...PKCS8_PREFIX, ...seed]);
  const key = await subtle().importKey("pkcs8", der, ED25519, true, ["sign"]);
  const x = (await subtle().exportKey("jwk", key)).x as string;
  if (privateJwk.x !== undefined && privateJwk.x !== x) {
    throw new TypeError("the signing key's x does not match its d");
  }
  const { iat } = options;
  if (iat !== undefined && !(Number.isInteger(iat) && iat >= 0)) {
    throw new TypeError("iat must be a non-negative integer");
  }
  const kid =
    options.kid ?? privateJwk.kid ?? (await jwkThumbprint({ kty: "OKP", crv: "Ed25519", x }));
  const header = { alg: SIGNATURE.algorithms.sign, kid, ...(iat === undefined ? {} : { iat }) };
  const entries = unpack(input);
  const manifest = entries.get(SIGNATURE.signedPath) as Uint8Array;
  const head = b64u(utf8(JSON.stringify(header)));
  const signature = new Uint8Array(
    await subtle().sign(ED25519, key, utf8(`${head}.${b64u(manifest)}`)),
  );
  entries.set(SIGNATURE.path, utf8(`${head}..${b64u(signature)}\n`));
  return pack(entries);
}

interface Parsed {
  header: { alg: string; kid: string };
  head: string;
  signature: Uint8Array;
}

function parse(raw: Uint8Array): Parsed | null {
  if (raw.length > SIGNATURE.maxBytes || raw.some((b) => b > 0x7f)) return null;
  let text = String.fromCharCode(...raw);
  if (text.endsWith("\n")) text = text.slice(0, -1);
  const parts = text.split(".");
  if (parts.length !== 3 || parts[1] !== "" || !parts[0]) return null;
  const head = unb64u(parts[0]);
  const signature = unb64u(parts[2] as string);
  if (!head || !signature) return null;
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(head));
  } catch {
    return null;
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) return null;
  const h = header as Record<string, unknown>;
  if (SIGNATURE.header.forbidden.some((name) => Object.hasOwn(h, name))) return null;
  if (typeof h.alg !== "string" || typeof h.kid !== "string" || !h.kid) return null;
  if (Object.hasOwn(h, "typ") && typeof h.typ !== "string") return null;
  if (
    Object.hasOwn(h, "iat") &&
    !(typeof h.iat === "number" && Number.isInteger(h.iat) && h.iat >= 0)
  ) {
    return null;
  }
  return { header: { alg: h.alg, kid: h.kid }, head: parts[0], signature };
}

function usable(key: unknown, kid: string): Uint8Array | null {
  if (!key || typeof key !== "object") return null;
  const k = key as Record<string, unknown>;
  const want = SIGNATURE.key;
  if (k.kid !== kid || k.kty !== want.kty || k.crv !== want.crv || typeof k.x !== "string")
    return null;
  if (Object.hasOwn(k, "use") && k.use !== want.use) return null;
  if (Object.hasOwn(k, "key_ops") && !(Array.isArray(k.key_ops) && k.key_ops.includes("verify")))
    return null;
  if (Object.hasOwn(k, "alg") && !SIGNATURE.algorithms.verify.includes(k.alg as string))
    return null;
  const x = unb64u(k.x);
  return x && x.length === 32 ? x : null;
}

async function verifyWith(
  x: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (signature.length !== 64) return false;
  try {
    const key = await subtle().importKey("raw", buffer(x), ED25519, false, ["verify"]);
    return await subtle().verify(ED25519, key, buffer(signature), buffer(message));
  } catch {
    return false; // an encoding that is not a curve point
  }
}

/**
 * Verify a package's signature against trusted keys. Never throws for malformed packages or signatures;
 * the result carries the first failing check's code (spec/signature.json, `order`).
 */
export async function verify(input: Uint8Array, trusted: TrustedKeys): Promise<Verification> {
  const report = await validate(input);
  const keys: readonly unknown[] = Array.isArray(trusted)
    ? trusted
    : Array.isArray((trusted as { keys?: unknown })?.keys)
      ? (trusted as { keys: unknown[] }).keys
      : [];
  const result = (code: SignatureCode | null, kid: string | null = null): Verification => ({
    ok: code === null,
    code,
    message: code ? (SIGNATURE.codes[code]?.message ?? code) : "The signature is valid.",
    kid,
    report,
  });
  if (!report.valid) return result("SIG_PACKAGE_INVALID");
  const entries = unpack(input);
  const raw = entries.get(SIGNATURE.path);
  if (!raw) return result("SIG_MISSING");
  const parsed = parse(raw);
  if (!parsed) return result("SIG_MALFORMED");
  const { header, head, signature } = parsed;
  if (!SIGNATURE.algorithms.verify.includes(header.alg)) return result("SIG_ALGORITHM", header.kid);
  const candidates = keys
    .map((k) => usable(k, header.kid))
    .filter((x): x is Uint8Array => x !== null);
  if (!candidates.length) return result("SIG_UNKNOWN_KEY", header.kid);
  const message = utf8(`${head}.${b64u(entries.get(SIGNATURE.signedPath) as Uint8Array)}`);
  for (const x of candidates) {
    if (await verifyWith(x, message, signature)) return result(null, header.kid);
  }
  return result("SIG_INVALID", header.kid);
}
