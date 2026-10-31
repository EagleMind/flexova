// Measure both deliverables at phone width, unthrottled and with 4x CPU throttle (≈ mid-range phone).
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const url = (f) => "file://" + path.join(__dirname, f);

async function run(browser, file, { throttle = 1, js = true, width = 375, scheme = "dark" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 740 }, colorScheme: scheme, javaScriptEnabled: js });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await cdp.send("Performance.enable");
  const t = Date.now();
  await page.goto(url(file), { waitUntil: "load", timeout: 300000 });
  const loadMs = Date.now() - t;
  const m = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const out = { file, throttle: throttle + "x", js, loadMs, nodes: m.Nodes, jsHeapMB: +(m.JSHeapUsedSize / 1e6).toFixed(1) };
  if (js) {
    const probe = await page.evaluate(() => ({
      fcpMs: Math.round(performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint")?.startTime ?? -1),
      pageOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    Object.assign(out, probe);
  }
  return { ctx, page, out, errors, cdp };
}

(async () => {
  const browser = await chromium.launch();
  const rows = [];
  // A. static-first plaintext
  for (const throttle of [1, 4]) {
    const r = await run(browser, "plain.fdoc.html", { throttle });
    rows.push({ ...r.out, cspErrors: r.errors.length }); await r.ctx.close();
  }
  const r320 = await run(browser, "plain.fdoc.html", { width: 320, scheme: "light" });
  rows.push({ ...r320.out, note: "320px light" });
  await r320.page.screenshot({ path: path.join(__dirname, "plain-320-light.png") }); await r320.ctx.close();
  const noJs = await run(browser, "plain.fdoc.html", { js: false });
  const h1 = await noJs.page.locator("h1").textContent(); const imgs = await noJs.page.locator("img").count();
  await noJs.page.screenshot({ path: path.join(__dirname, "plain-nojs-dark.png") });
  rows.push({ ...noJs.out, note: `JS OFF: h1="${h1}", ${imgs} <img>` }); await noJs.ctx.close();

  // B. sealed
  for (const throttle of [1, 4]) {
    const r = await run(browser, "sealed.fdoc.html", { throttle });
    await r.page.fill("#pass", "correct horse battery staple");
    const t = Date.now();
    await r.page.click("button");
    await r.page.waitForFunction(() => window.__fdTimings, null, { timeout: 300000 });
    const clickToDoneMs = Date.now() - t;
    const tm = await r.page.evaluate(() => ({ ...window.__fdTimings, firstChapterMs: window.__fdFirstChapterMs }));
    await r.page.locator("#fig-0 img").scrollIntoViewIfNeeded();
    await r.page.waitForFunction(() => document.querySelector("#fig-0 img").src.startsWith("blob:"));
    const allImgMs = await r.page.evaluate(() => window.__fdDecryptAllImages());
    const probe = await r.page.evaluate(() => ({ chapters: document.querySelectorAll("#doc section").length,
      pageOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scriptsInContent: document.querySelectorAll("#doc script").length }));
    if (throttle === 4) await r.page.screenshot({ path: path.join(__dirname, "sealed-375-dark.png") });
    rows.push({ file: "sealed.fdoc.html", throttle: throttle + "x", loadMs: r.out.loadMs, unlockKdfMs: Math.round(tm.unlockMs),
      firstChapterMs: Math.round(tm.firstChapterMs), all1000PagesMs: Math.round(tm.allChaptersMs), clickToDoneMs,
      decryptAllPhotosMs: Math.round(allImgMs), ...probe, cspErrors: r.errors.length });
    await r.ctx.close();
  }

  // C. file:// storage isolation probe: is localStorage shared between unrelated local HTML files?
  const dir = path.join(__dirname, "storage-probe"); fs.mkdirSync(path.join(dir, "a"), { recursive: true }); fs.mkdirSync(path.join(dir, "b"), { recursive: true });
  fs.writeFileSync(path.join(dir, "a", "doc1.html"), "<!doctype html><title>a</title>");
  fs.writeFileSync(path.join(dir, "b", "evil.html"), "<!doctype html><title>b</title>");
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await p.goto("file://" + path.join(dir, "a", "doc1.html")); await p.evaluate(() => localStorage.setItem("fd:lastpos", "secret-ish"));
  await p.goto("file://" + path.join(dir, "b", "evil.html"));
  const leaked = await p.evaluate(() => localStorage.getItem("fd:lastpos"));
  const origin = await p.evaluate(() => location.origin);
  // D. Ed25519 in WebCrypto
  const ed = await p.evaluate(async () => { try { const k = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    const s = await crypto.subtle.sign("Ed25519", k.privateKey, new Uint8Array([1])); return await crypto.subtle.verify("Ed25519", k.publicKey, s, new Uint8Array([1])); } catch (e) { return String(e); } });
  await ctx.close(); await browser.close();

  for (const r of rows) console.log(JSON.stringify(r));
  console.log(JSON.stringify({ fileStorageSharedAcrossUnrelatedFiles: leaked === "secret-ish", fileOrigin: origin, ed25519: ed }));
})();
