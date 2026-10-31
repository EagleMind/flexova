// Embed <flex-viewer> in a hostile host page, kill the server (true offline), reopen from the service-worker
// cache, open documents from local disk, and attack it with malicious packages.
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path"), fs = require("fs"), zlib = require("zlib");
const WEB = path.join(__dirname, "web"), OUT = path.join(__dirname, "out"), PORT = 8765;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn("python3", ["-I", "-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", WEB], { stdio: "ignore" });
  await sleep(800);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  const log = (k, v) => console.log(`${k.padEnd(52)} ${typeof v === "string" ? v : JSON.stringify(v)}`);

  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();                                               // now controlled by the service worker
  log("service worker controlling page", await page.evaluate(() => !!navigator.serviceWorker.controller));

  server.kill(); await sleep(300); await ctx.setOffline(true);      // no server, no network
  await page.reload();
  log("app shell reloaded with server dead + offline", await page.evaluate(() => !!customElements.get("flex-viewer")));

  const open = async (file) => {
    const done = page.evaluate(() => new Promise((res) => {
      const v = document.getElementById("v");
      v.addEventListener("flex-load", (e) => res({ ok: true, ...e.detail }), { once: true });
      v.addEventListener("flex-error", (e) => res({ ok: false, error: e.detail }), { once: true });
    }));
    await page.setInputFiles("#pick", path.join(OUT, file));
    return done;
  };

  // 1. legitimate document
  log("open manual.flex from disk (offline)", await open("manual.flex"));
  const probe = await page.evaluate(async () => {
    const root = document.getElementById("v").shadowRoot, p = root.getElementById("p1"), img = root.querySelector("img");
    await img.decode().catch(() => {});
    const cs = getComputedStyle(p);
    return { headings: [...root.querySelectorAll("h1")].map((h) => h.textContent), pColor: cs.color, pFontSize: cs.fontSize,
      pMargin: cs.marginLeft, pOutline: cs.outlineStyle, imgVisible: getComputedStyle(img).display !== "none" && img.naturalWidth > 0,
      hostSeesDocIds: document.getElementById("p1") !== null, overflowPx: document.documentElement.scrollWidth - innerWidth };
  });
  log("render: headings", probe.headings);
  log("host CSS leaked? (want rgb(232,230,227) / 17px / 0px / none)", `${probe.pColor} / ${probe.pFontSize} / ${probe.pMargin} / ${probe.pOutline}`);
  log("image rendered despite host img{display:none!important}", probe.imgVisible);
  log("document IDs leak into host page", probe.hostSeesDocIds);
  log("horizontal overflow at 375px (px)", probe.overflowPx);
  await page.screenshot({ path: path.join(__dirname, "viewer-offline-dark.png"), fullPage: true });

  // 2. attacks
  const hostile = path.join(__dirname, "hostile"); fs.mkdirSync(hostile, { recursive: true });
  require("child_process").execFileSync("python3", ["-I", path.join(__dirname, "make_hostile.py"), hostile], { stdio: "inherit" });
  for (const f of fs.readdirSync(hostile)) fs.copyFileSync(path.join(hostile, f), path.join(OUT, f));
  const r = await open("xss.flex");
  const xss = await page.evaluate(() => {
    const root = document.getElementById("v").shadowRoot; root.getElementById("js")?.click(); root.querySelector("p")?.click();
    return { pwned: window.__pwned ?? null, scripts: root.querySelectorAll("script,iframe,svg").length,
      handlers: [...root.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => a.name.startsWith("on") || a.name === "style")).length,
      jsHref: root.getElementById("js")?.getAttribute("href") ?? null, ext: root.getElementById("ext")?.rel,
      tokenInjection: [...root.querySelectorAll("style")].some((s) => s.textContent.includes("evil.example")) };
  });
  await sleep(300);
  log("xss.flex loaded", r.ok);
  log("  script/handler/javascript:/style/iframe/svg executed", xss.pwned === null ? "none (pass)" : `PWNED ${xss.pwned}`);
  log("  dangerous nodes/attrs surviving", { scriptsIframesSvg: xss.scripts, handlersOrStyle: xss.handlers, jsHref: xss.jsHref });
  log("  external link rel", xss.ext);
  log("  CSS injection via tokens", xss.tokenInjection ? "INJECTED" : "blocked (pass)");
  for (const f of ["xml-bomb.flex", "traversal.flex", "bomb.flex", "sealed.flex"]) log(f, await open(f));
  log("uncaught page errors", errors.length ? errors : "none");
  log("flex-viewer.js size", `${fs.statSync(path.join(WEB, "flex-viewer.js")).size} B raw, ${zlib.gzipSync(fs.readFileSync(path.join(WEB, "flex-viewer.js")), { level: 9 }).length} B gzip`);
  await browser.close();
})();
