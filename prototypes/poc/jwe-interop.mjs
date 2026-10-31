// Interop matrix: our tiny WebCrypto JWE <-> jose (Node) <-> jwcrypto (Python), plus negative tests.
import * as F from "./fdoc-jwe.mjs";
import * as jose from "jose";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const PASS = "correct horse battery staple";
const results = [];
const check = async (name, fn) => { try { const v = await fn(); results.push([name, v === true ? "ok" : `FAIL (${v})`]); }
  catch (e) { results.push([name, `FAIL: ${e.message}`]); } };
const expectThrow = async (name, fn) => { try { await fn(); results.push([name, "FAIL (accepted)"]); }
  catch (e) { results.push([name, `ok (rejected: ${e.message})`]); } };

const orgKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const orgPubJwk = await crypto.subtle.exportKey("jwk", orgKeys.publicKey);
const orgPrivJwk = await crypto.subtle.exportKey("jwk", orgKeys.privateKey);

const dek = F.newDek();
const keyring = { v: 1, docId: "urn:uuid:7d1c-demo", dek: F.b64u(dek), entries: ["content/ch1.xhtml", "assets/fig1.avif"],
  meta: { title: "Q3 Board Pack" } };
let t = performance.now();
const jwe = await F.sealKeyring(keyring, [
  { type: "passphrase", passphrase: PASS, kid: "passphrase" },
  { type: "ecdh", publicJwk: orgPubJwk, kid: "org-recovery-2026" },
]);
const sealMs = performance.now() - t;
writeFileSync(new URL("./keyring.jwe.json", import.meta.url), JSON.stringify(jwe, null, 1));
writeFileSync(new URL("./org-private.jwk.json", import.meta.url), JSON.stringify(orgPrivJwk));

// 1. ours -> ours
await check("ours→ours (passphrase)", async () => (await F.openKeyring(jwe, { passphrase: PASS })).dek === keyring.dek);
await check("ours→ours (org recovery key)", async () => (await F.openKeyring(jwe, { privateKey: orgKeys.privateKey })).dek === keyring.dek);
// 2. ours -> jose
await check("ours→jose (passphrase, maxPBES2Count raised)", async () => {
  const r = await jose.generalDecrypt(jwe, new TextEncoder().encode(PASS), { keyManagementAlgorithms: ["PBES2-HS512+A256KW"], maxPBES2Count: F.P2C_MAX });
  return JSON.parse(new TextDecoder().decode(r.plaintext)).dek === keyring.dek; });
await expectThrow("ours→jose with DEFAULT cap (10k)", () => jose.generalDecrypt(jwe, new TextEncoder().encode(PASS), { keyManagementAlgorithms: ["PBES2-HS512+A256KW"] }));
await check("ours→jose (org recovery key)", async () => {
  const r = await jose.generalDecrypt(jwe, await jose.importJWK(orgPrivJwk, "ECDH-ES+A256KW"));
  return JSON.parse(new TextDecoder().decode(r.plaintext)).dek === keyring.dek; });
// 3. jose (flattened, explicit p2c) -> ours
const joseFlat = await new jose.FlattenedEncrypt(new TextEncoder().encode(JSON.stringify(keyring)))
  .setProtectedHeader({ enc: "A256GCM" }).setUnprotectedHeader({ alg: "PBES2-HS512+A256KW" })
  .setKeyManagementParameters({ p2c: 600_000 }).encrypt(new TextEncoder().encode(PASS));
await check("jose(flattened, p2c=600k)→ours", async () => (await F.openKeyring(joseFlat, { passphrase: PASS })).dek === keyring.dek);
// 4. jose GeneralEncrypt default p2c -> ours must REFUSE (too weak)
const joseGeneral = await new jose.GeneralEncrypt(new TextEncoder().encode("{}")).setProtectedHeader({ enc: "A256GCM" })
  .addRecipient(new TextEncoder().encode(PASS)).setUnprotectedHeader({ alg: "PBES2-HS512+A256KW" }).encrypt();
results.push(["jose GeneralEncrypt actual p2c", String(JSON.parse(Buffer.from(joseGeneral.protected, "base64url")).p2c)]);
await expectThrow("jose(general, p2c≈2k)→ours", () => F.openKeyring(joseGeneral, { passphrase: PASS }));
// 5. Python jwcrypto both directions
const py = execFileSync("python3", ["-I", new URL("./jwe-interop.py", import.meta.url).pathname,
  new URL("./keyring.jwe.json", import.meta.url).pathname, new URL("./org-private.jwk.json", import.meta.url).pathname, PASS,
  keyring.dek], { encoding: "utf8" });
const pyOut = JSON.parse(py);
for (const [k, v] of Object.entries(pyOut.results)) results.push([k, v]);
await check("jwcrypto(p2c=600k)→ours", async () => (await F.openKeyring(pyOut.jwe, { passphrase: PASS })).dek === keyring.dek);
// 6. negative tests
await expectThrow("wrong passphrase", () => F.openKeyring(jwe, { passphrase: "nope" }));
const dos = structuredClone(jwe); dos.recipients[0].header.p2c = 10 ** 9;
await expectThrow("p2c = 1e9 (DoS header)", () => F.openKeyring(dos, { passphrase: PASS }));
const down = structuredClone(jwe); down.recipients[0].header.p2c = 1000;
await expectThrow("p2c = 1000 (downgrade header)", () => F.openKeyring(down, { passphrase: PASS }));
const alg = structuredClone(jwe); alg.recipients = [{ header: { alg: "dir" }, encrypted_key: "" }];
await expectThrow("alg=dir (not allowlisted)", () => F.openKeyring(alg, { passphrase: PASS }));
const zip = structuredClone(jwe); zip.protected = F.b64u(new TextEncoder().encode('{"enc":"A256GCM","zip":"DEF"}'));
await expectThrow("zip=DEF header", () => F.openKeyring(zip, { passphrase: PASS }));
const bad = structuredClone(jwe); bad.recipients[1].header.epk.x = bad.recipients[1].header.epk.y;
await expectThrow("off-curve epk (invalid-curve attack)", () => F.openKeyring(bad, { privateKey: orgKeys.privateKey }));
// 7. entries
const open = await F.entryOpener(keyring.dek);
const blob = await F.sealEntry(dek, "content/ch1.xhtml", new TextEncoder().encode("<p>hello</p>"));
await check("entry round-trip", async () => new TextDecoder().decode(await open("content/ch1.xhtml", blob)) === "<p>hello</p>");
await expectThrow("entry moved to another path", () => open("assets/fig1.avif", blob));

for (const [k, v] of results) console.log(`${v.startsWith("ok") || /^\d+$/.test(v) ? "✔" : "✘"} ${k.padEnd(46)} ${v}`);
console.log(`seal (2 recipients, p2c=600k): ${sealMs.toFixed(0)} ms`);
