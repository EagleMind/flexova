// Minimal "compiler": seal a gzipped JSON AST and emit a self-contained HTML file with a CSP-hashed runtime.
import { seal, unlock } from "./fdoc-crypto.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const ast = {
  type: "doc", children: [
    { type: "heading", id: "s1", level: 1, children: [{ type: "text", value: "Q3 Report" }] },
    { type: "paragraph", id: "p1", children: [{ type: "text", value: "Revenue grew " },
      { type: "strong", children: [{ type: "text", value: "18%" }] }, { type: "text", value: "." }] },
  ],
};
const pass = "correct horse battery staple";
const entries = new Map([["content/document.json.gz", gzipSync(JSON.stringify(ast))]]);

// --- Node round-trip + tamper tests ---
let t = performance.now();
const { headerBytes, sealed } = await seal(entries, pass, "urn:uuid:test");
console.log(`seal: ${(performance.now() - t).toFixed(0)} ms`);
t = performance.now();
const dec = await unlock(headerBytes, pass);
console.log(`unlock (PBKDF2 600k): ${(performance.now() - t).toFixed(0)} ms`);
const out = await dec("content/document.json.gz", sealed.get("content/document.json.gz"));
console.log("node round-trip ok:", Buffer.compare(Buffer.from(out), entries.get("content/document.json.gz")) === 0);
try { await unlock(headerBytes, "wrong"); console.log("wrong pass: NOT rejected"); } catch { console.log("wrong pass rejected: ok"); }
try { await dec("assets/other.avif", sealed.get("content/document.json.gz")); console.log("path swap: NOT rejected"); } catch { console.log("path-swap rejected: ok"); }
const tampered = sealed.get("content/document.json.gz").slice(); tampered[20] ^= 1;
try { await dec("content/document.json.gz", tampered); console.log("tamper: NOT rejected"); } catch { console.log("tamper rejected: ok"); }

// --- Emit single-file HTML ---
const cryptoSrc = readFileSync(new URL("./fdoc-crypto.mjs", import.meta.url), "utf8")
  .replace(/export async function/g, "async function");
const runtime = `${cryptoSrc}
const $ = (s) => document.querySelector(s);
const toBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function render(n) { // AST -> DOM via createElement only: no innerHTML, no injection surface
  if (n.type === "text") return document.createTextNode(n.value);
  const tag = { doc: "article", heading: "h" + n.level, paragraph: "p", strong: "strong" }[n.type];
  if (!tag) return document.createComment("unsupported:" + n.type);
  const el = document.createElement(tag);
  if (n.id) el.id = n.id;
  for (const c of n.children || []) el.append(render(c));
  return el;
}
$("#unlock").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const headerBytes = new TextEncoder().encode($("#fdoc-header").textContent);
    const dec = await unlock(headerBytes, $("#pass").value);
    const node = $('[data-path="content/document.json.gz"]');
    const gz = await dec(node.dataset.path, toBytes(node.textContent.trim()));
    const json = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    $("#doc").replaceChildren(render(JSON.parse(json)));
    $("#unlock").hidden = true;
  } catch (err) { $("#err").textContent = "Wrong passphrase or damaged file."; }
});`;
const css = `:root{color-scheme:light dark;--bg:light-dark(#fff,#111);--fg:light-dark(#111,#eee)}body{background:var(--bg);color:var(--fg);font:1.0625rem/1.6 system-ui,sans-serif;max-width:70ch;margin:auto;padding:1rem}`;
const sha = (s) => "sha256-" + createHash("sha256").update(s).digest("base64");
const csp = `default-src 'none'; script-src '${sha(runtime)}'; style-src '${sha(css)}'; img-src blob:; media-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
const headerText = new TextDecoder().decode(headerBytes).replace(/</g, "\\u003c"); // never let "</script" appear

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Q3 Report (encrypted)</title><style>${css}</style></head>
<body>
<form id="unlock"><label>Passphrase <input id="pass" type="password" autocomplete="off"></label> <button>Open</button> <output id="err"></output></form>
<main id="doc"><noscript>This document is encrypted. Open it in a browser with JavaScript enabled, or at https://reader.example.org.</noscript></main>
<script type="application/vnd.fdoc.header+json" id="fdoc-header">${headerText}</script>
${[...sealed].map(([p, b]) => `<script type="application/vnd.fdoc.entry" data-path="${p}">${Buffer.from(b).toString("base64")}</script>`).join("\n")}
<script>${runtime}</script>
</body></html>`;
writeFileSync(new URL("./report.fdoc.html", import.meta.url), html);
console.log(`wrote report.fdoc.html (${html.length} bytes, runtime ${runtime.length} bytes unminified)`);
