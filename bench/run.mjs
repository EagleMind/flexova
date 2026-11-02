#!/usr/bin/env node
// 1,000-page benchmark (requires `pnpm build`): writes, validates and renders a large document, then times
// the viewer and the static page in Chromium, unthrottled and at 4x CPU slowdown (roughly a mid-range phone).
// Fails if any measurement exceeds its threshold. Thresholds are generous so shared CI runners don't flake.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { toHtml } from "../packages/html/dist/index.js";
import { validate, write } from "../packages/core/dist/index.js";

const CHAPTERS = 100;
const PAGES_PER_CHAPTER = 10;
const WORDS_PER_PAGE = 450;
const THRESHOLD_MS = {
  write: 15000,
  validate: 10000,
  toHtml: 10000,
  viewer: 8000,
  staticPage: 8000,
  viewerSlow: 20000,
  staticSlow: 20000,
};

let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const VOCAB =
  "the of and to in system report quarter revenue growth customer risk control audit model data process service network value market operation cost analysis review policy security team product strategy result impact torque bolt panel voltage".split(
    " ",
  );
const words = (n) =>
  Array.from({ length: n }, () => VOCAB[Math.floor(rnd() * VOCAB.length)]).join(" ");
const chart = (i) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" role="img">` +
      Array.from(
        { length: 6 },
        (_, k) =>
          `<rect x="${k * 20}" y="${60 - ((i * 7 + k * 9) % 55)}" width="16" height="${(i * 7 + k * 9) % 55}" fill="#0b5fff"/>`,
      ).join("") +
      `</svg>`,
  );

const time = async (fn) => {
  const t = performance.now();
  const value = await fn();
  return [value, Math.round(performance.now() - t)];
};

const chapters = Array.from({ length: CHAPTERS }, (_, c) => {
  let body = `<section id="s"><h1 id="t">Chapter ${c + 1}: ${words(4)}</h1>`;
  for (let p = 0; p < PAGES_PER_CHAPTER; p++)
    body +=
      `<h2 id="p${p}">Section ${p + 1}</h2>` +
      Array.from({ length: 3 }, () => `<p>${words(WORDS_PER_PAGE / 3)}</p>`).join("");
  body += `<figure id="f"><img src="../assets/chart-${c}.svg" alt="Chart ${c + 1}" width="120" height="60"/><figcaption>Figure ${c + 1}</figcaption></figure>`;
  body += `<table id="tb"><caption>Readings</caption><thead><tr>${Array.from({ length: 8 }, (_, i) => `<th scope="col">Metric ${i}</th>`).join("")}</tr></thead><tbody>`;
  for (let r = 0; r < 10; r++)
    body += `<tr>${Array.from({ length: 8 }, () => `<td>${(rnd() * 1e5).toFixed(2)}</td>`).join("")}</tr>`;
  return { title: `Chapter ${c + 1}`, body: body + "</tbody></table></section>" };
});
const assets = Array.from({ length: CHAPTERS }, (_, c) => ({
  path: `assets/chart-${c}.svg`,
  mediaType: "image/svg+xml",
  data: chart(c),
}));

const results = {};
const [pkg, writeMs] = await time(() =>
  write({
    identifier: "urn:uuid:bench-1000",
    title: "Benchmark manual",
    language: "en",
    modified: "2026-11-02T00:00:00Z",
    chapters,
    assets,
  }),
);
results.write = writeMs;
const [report, validateMs] = await time(() => validate(pkg));
if (!report.valid) throw new Error("benchmark package is invalid: " + report.codes.join(", "));
results.validate = validateMs;
const [{ html }, toHtmlMs] = await time(() => toHtml(pkg));
results.toHtml = toHtmlMs;

const out = new URL("../build/bench/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("bench.flexova", out), pkg);
writeFileSync(new URL("bench.flexova.html", out), html);

const viewerJs = readFileSync(
  new URL("../packages/viewer/dist/flexova-viewer.min.js", import.meta.url),
);
const server = createServer((req, res) => {
  if (req.url === "/viewer.js")
    return res.writeHead(200, { "content-type": "text/javascript" }).end(viewerJs);
  if (req.url === "/bench.flexova") return res.writeHead(200).end(pkg);
  if (req.url === "/bench.flexova.html")
    return res.writeHead(200, { "content-type": "text/html" }).end(html);
  res
    .writeHead(200, { "content-type": "text/html" })
    .end(
      '<!doctype html><html lang="en"><title>bench</title><script src="/viewer.js"></script><flexova-viewer id="v"></flexova-viewer>',
    );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
for (const [label, rate] of [
  ["", 1],
  ["Slow", 4],
]) {
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.goto(base + "/");
  results[`viewer${label}`] = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch("/bench.flexova")).arrayBuffer());
    const v = document.getElementById("v");
    const t = performance.now();
    const done = new Promise((r) => v.addEventListener("flexova-load", r, { once: true }));
    await v.load(bytes);
    await done;
    return Math.round(performance.now() - t);
  });
  const t = Date.now();
  await page.goto(base + "/bench.flexova.html", { waitUntil: "load" });
  results[`static${label === "" ? "Page" : label}`] = Date.now() - t;
  await page.close();
}
await browser.close();
server.close();

const pages = CHAPTERS * PAGES_PER_CHAPTER;
console.log(
  `Benchmark: ${pages} pages, ${CHAPTERS} images; package ${(pkg.length / 1e6).toFixed(2)} MB, static page ${(html.length / 1e6).toFixed(2)} MB`,
);
let failed = false;
for (const [key, ms] of Object.entries(results)) {
  const ok = ms <= THRESHOLD_MS[key];
  failed ||= !ok;
  console.log(
    `${ok ? "ok  " : "SLOW"} ${key.padEnd(12)} ${String(ms).padStart(6)} ms  (threshold ${THRESHOLD_MS[key]} ms)`,
  );
}
if (failed) process.exit(1);
