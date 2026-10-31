
// ---- embedded reader runtime: unlock → stream chapters → sanitize-by-reconstruction → lazy images ----
const $ = (s) => document.querySelector(s);
const b64bytes = (s) => (Uint8Array.fromBase64 ? Uint8Array.fromBase64(s) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const entry = (path) => b64bytes(document.querySelector(`script[data-path="${CSS.escape(path)}"]`).textContent.trim());
const gunzip = (u8) => new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).text();

// Allowlist profile: element -> permitted attributes. Anything else is dropped (children kept for unknown elements).
const PROFILE = { section: ["id", "class"], h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"], p: ["id"], strong: [], em: [], code: [],
  pre: [], a: ["href"], ul: [], ol: [], li: [], blockquote: [], figure: ["id"], figcaption: [], img: ["src", "alt", "width", "height"],
  div: ["class", "role", "aria-label", "tabindex"], table: [], thead: [], tbody: [], tr: [], th: ["scope", "colspan", "rowspan"],
  td: ["colspan", "rowspan"], aside: ["class"], br: [] };
const SAFE_HREF = /^(https:|mailto:|#)/i;
function rebuild(src, assets) {
  if (src.nodeType === 3) return document.createTextNode(src.data);
  if (src.nodeType !== 1) return null;
  const tag = src.localName, allowed = PROFILE[tag];
  const out = allowed ? document.createElement(tag) : document.createDocumentFragment();
  if (allowed) for (const name of allowed) {
    const v = src.getAttribute(name); if (v === null) continue;
    if (name === "href" && !SAFE_HREF.test(v)) continue;
    if (name === "src") { const a = assets[v.replace(/^asset:/, "")]; if (a) { out.dataset.fdAsset = a.path; out.dataset.fdType = a.type; } continue; }
    out.setAttribute(name, v);
  }
  for (const c of src.childNodes) { const r = rebuild(c, assets); if (r) out.append(r); }
  return out;
}

$("#unlock").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t0 = performance.now();
  let ring;
  try { ring = await openKeyring(JSON.parse($("#fd-keyring").textContent), { passphrase: $("#pass").value }); }
  catch { $("#err").textContent = "Wrong passphrase or damaged file."; return; }
  $("#unlock").hidden = true;
  const open = await entryOpener(ring.dek);
  const t1 = performance.now();
  const io = new IntersectionObserver((list) => list.forEach(async (en) => {
    if (!en.isIntersecting) return; io.unobserve(en.target);
    const p = en.target.dataset.fdAsset;
    en.target.src = URL.createObjectURL(new Blob([await open(p, entry(p))], { type: en.target.dataset.fdType }));
  }), { rootMargin: "200% 0px" });
  const doc = $("#doc"), parser = new DOMParser();
  for (const [i, path] of ring.spine.entries()) {
    const xhtml = await gunzip(await open(path, entry(path)));
    const parsed = parser.parseFromString(xhtml, "application/xhtml+xml");
    if (parsed.querySelector("parsererror")) throw new Error("malformed chapter " + path);
    const node = rebuild(parsed.documentElement, ring.assets);
    node.querySelectorAll?.("img[data-fd-asset]").forEach((img) => io.observe(img));
    doc.append(node);
    if (i === 0) window.__fdFirstChapterMs = performance.now() - t0;
  }
  window.__fdTimings = { unlockMs: t1 - t0, allChaptersMs: performance.now() - t0 };
  window.__fdDecryptAllImages = async () => { const s = performance.now();
    for (const a of Object.values(ring.assets)) await open(a.path, entry(a.path)); return performance.now() - s; };
});
