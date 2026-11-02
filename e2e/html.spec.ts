// Static .flexova.html renditions opened straight from disk (file://): readable without JavaScript,
// no network, no layout overflow, both themes, in-page links, and accessible.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { HTML_DIR, SHOWCASE, THEMES, WCAG_TAGS, WIDTHS, htmlName, validFixtures } from "./fixtures";

const fileUrl = (rel: string) => new URL(htmlName(rel), HTML_DIR).href;

test.describe("readable with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });
  for (const rel of validFixtures()) {
    test(rel, async ({ page }) => {
      const blocked: string[] = [];
      page.on(
        "console",
        (m) => /Content.Security.Policy|Refused/i.test(m.text()) && blocked.push(m.text()),
      );
      page.on(
        "request",
        (r) =>
          !r.url().startsWith("file:") && !r.url().startsWith("data:") && blocked.push(r.url()),
      );
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(fileUrl(rel));
      await expect(page.locator("main")).not.toBeEmpty();
      expect(await page.locator("main img").count()).toBe(
        await page.locator('main img[src^="data:"]').count(),
      );
      expect(blocked).toEqual([]);
    });
  }
});

test.describe("layout and themes", () => {
  for (const rel of SHOWCASE) {
    for (const width of WIDTHS) {
      for (const scheme of THEMES) {
        test(`${rel} @${width}px ${scheme}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 800 });
          await page.emulateMedia({ colorScheme: scheme });
          await page.goto(fileUrl(rel));
          const probe = await page.evaluate(async () => {
            const imgs = [...document.querySelectorAll("img")];
            const decoded = await Promise.all(
              imgs.map((i) =>
                i.decode().then(
                  () => true,
                  () => false,
                ),
              ),
            );
            return {
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              bg: getComputedStyle(document.body).backgroundColor,
              broken: decoded.filter((ok) => !ok).length,
            };
          });
          expect(probe.overflow).toBeLessThanOrEqual(0);
          expect(probe.broken).toBe(0);
          expect(probe.bg).toBe(scheme === "dark" ? "rgb(18, 18, 18)" : "rgb(255, 255, 255)");
        });
      }
    }
  }
});

test("in-page links work without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(fileUrl("valid/links.flexova"));
  await page.locator('a[href="#d2-b-detail"]').click();
  await expect(page).toHaveURL(/#d2-b-detail$/);
  await page.locator('nav a[href="#d3"]').click();
  await expect(page).toHaveURL(/#d3$/);
  await context.close();
});

test.describe("accessibility (axe, WCAG 2.2 AA)", () => {
  for (const rel of validFixtures()) {
    test(rel, async ({ page }) => {
      await page.goto(fileUrl(rel));
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
        ),
      ).toEqual([]);
    });
  }
});
