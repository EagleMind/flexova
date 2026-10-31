// Open the emitted file from file:// in Chromium, unlock it, and confirm rendering + no CSP violations.
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 667 }, colorScheme: "dark" });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("file://" + path.join(__dirname, "report.fdoc.html"));
  console.log("secure context on file://:", await page.evaluate(() => window.isSecureContext && !!crypto.subtle));
  await page.fill("#pass", "wrong");
  await page.click("button");
  await page.waitForFunction(() => document.querySelector("#err").textContent.length > 0);
  console.log("wrong pass message:", await page.textContent("#err"));
  await page.fill("#pass", "correct horse battery staple");
  const t = Date.now();
  await page.click("button");
  await page.waitForSelector("#doc h1");
  console.log(`unlocked + rendered in ${Date.now() - t} ms:`, JSON.stringify(await page.textContent("#doc")));
  console.log("dark bg:", await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  console.log("console/CSP errors:", errors.length ? errors : "none");
  await browser.close();
})();
