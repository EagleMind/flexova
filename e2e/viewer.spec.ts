// <flexova-viewer> in real browsers: rendering, layout, themes, isolation, offline use, attacks, accessibility.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SHOWCASE, THEMES, WCAG_TAGS, WIDTHS, rejectedFixtures, validFixtures } from "./fixtures";

interface Outcome {
  ok: boolean;
  detail: { code?: string; title?: string; chapters?: number; toc?: { href: string }[] };
}

/** Open the hostile host page and load a fixture into the viewer, from the server or from inline bytes. */
async function open(page: Page, rel: string, opts: { bytes?: number[] } = {}): Promise<Outcome> {
  await page.goto("/e2e/www/viewer.html");
  return page.evaluate(
    async ({ url, bytes }) => {
      const v = document.getElementById("v") as HTMLElement & {
        load(b: Uint8Array): Promise<void>;
      };
      const data = bytes
        ? new Uint8Array(bytes)
        : new Uint8Array(await (await fetch(url)).arrayBuffer());
      const outcome = new Promise((resolve) => {
        v.addEventListener(
          "flexova-load",
          (e) => resolve({ ok: true, detail: (e as CustomEvent).detail }),
          { once: true },
        );
        v.addEventListener(
          "flexova-error",
          (e) => resolve({ ok: false, detail: (e as CustomEvent).detail }),
          { once: true },
        );
      });
      await v.load(data);
      return outcome as Promise<Outcome>;
    },
    { url: `/conformance/${rel}`, bytes: opts.bytes },
  );
}

/** Wait until every image in the document has decoded; returns how many failed to decode. */
const brokenImages = (page: Page) =>
  page.evaluate(async () => {
    const imgs = [...(document.getElementById("v")?.shadowRoot?.querySelectorAll("img") ?? [])];
    const results = await Promise.all(
      imgs.map((i) =>
        i.decode().then(
          () => true,
          () => false,
        ),
      ),
    );
    return results.filter((ok) => !ok).length;
  });

const overflowPx = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("dialog", (d) => {
    problems.push(`dialog: ${d.message()}`);
    void d.dismiss();
  });
  page.on("request", (r) => {
    const url = r.url();
    if (
      !url.startsWith("http://127.0.0.1:4173/") &&
      !url.startsWith("blob:") &&
      !url.startsWith("data:")
    ) {
      problems.push(`network request: ${url}`);
    }
  });
  return problems;
}

test.describe("renders every valid fixture", () => {
  for (const rel of validFixtures()) {
    test(rel, async ({ page }) => {
      const problems = collectProblems(page);
      await page.setViewportSize({ width: 320, height: 640 });
      const outcome = await open(page, rel);
      expect(outcome.ok, JSON.stringify(outcome.detail)).toBe(true);
      expect(await brokenImages(page)).toBe(0);
      expect(await overflowPx(page)).toBeLessThanOrEqual(0);
      expect(problems).toEqual([]);
    });
  }
});

test.describe("layout and theme matrix", () => {
  for (const rel of SHOWCASE) {
    for (const width of WIDTHS) {
      for (const scheme of THEMES) {
        test(`${rel} @${width}px ${scheme}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 800 });
          await page.emulateMedia({ colorScheme: scheme });
          expect((await open(page, rel)).ok).toBe(true);
          expect(await overflowPx(page)).toBeLessThanOrEqual(0);
          const bg = await page.evaluate(
            () => getComputedStyle(document.getElementById("v") as Element).backgroundColor,
          );
          expect(bg).toBe(scheme === "dark" ? "rgb(18, 18, 18)" : "rgb(255, 255, 255)");
        });
      }
    }
  }

  test("the theme attribute overrides the system preference", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await open(page, "valid/tokens-full.flexova");
    const bg = () =>
      page.evaluate(
        () => getComputedStyle(document.getElementById("v") as Element).backgroundColor,
      );
    expect(await bg()).toBe("rgb(255, 255, 255)");
    await page.evaluate(() => document.getElementById("v")?.setAttribute("theme", "dark"));
    expect(await bg()).toBe("rgb(0, 0, 0)"); // tokens-full sets bg.dark to #000000
  });
});

test.describe("isolation from the host page", () => {
  test("host styles and ids do not leak in or out", async ({ page }) => {
    await open(page, "valid/minimal.flexova");
    const probe = await page.evaluate(() => {
      const v = document.getElementById("v") as HTMLElement;
      const p = v.shadowRoot?.querySelector("p") as HTMLElement;
      const s = getComputedStyle(p);
      return {
        color: s.color,
        fontSize: s.fontSize,
        margin: s.marginLeft,
        hostSeesIds: !!document.getElementById("d1"),
      };
    });
    expect(probe).toEqual({
      color: "rgb(26, 26, 26)",
      fontSize: "17px",
      margin: "0px",
      hostSeesIds: false,
    });
  });

  test("images stay visible despite host img { display: none !important }", async ({ page }) => {
    await open(page, "valid/images.flexova");
    const hidden = await page.evaluate(
      () =>
        [...(document.getElementById("v")?.shadowRoot?.querySelectorAll("img") ?? [])].filter(
          (i) => getComputedStyle(i).display === "none",
        ).length,
    );
    expect(hidden).toBe(0);
  });
});

test.describe("navigation", () => {
  test("internal links and goTo() scroll within the document", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 400 });
    const outcome = await open(page, "valid/links.flexova");
    expect(outcome.detail.toc?.map((t) => t.href)).toEqual(["#d1", "#d2", "#d3"]);
    await page.evaluate(() =>
      (
        document
          .getElementById("v")
          ?.shadowRoot?.querySelector('a[href="#d2-b-detail"]') as HTMLElement
      ).click(),
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const r = document
            .getElementById("v")
            ?.shadowRoot?.getElementById("d2-b-detail")
            ?.getBoundingClientRect();
          return r ? r.top >= -1 && r.top < innerHeight : false;
        }),
      )
      .toBe(true);
    const external = await page.evaluate(() => {
      const a = document.getElementById("v")?.shadowRoot?.querySelector('a[href^="mailto:"]');
      return [a?.getAttribute("target"), a?.getAttribute("rel")];
    });
    expect(external).toEqual(["_blank", "noopener noreferrer"]);
  });
});

test.describe("offline", () => {
  test("loads a document with the network switched off", async ({
    page,
    context,
    request,
    browserName,
  }) => {
    const bytes = [...(await (await request.get("/conformance/valid/images.flexova")).body())];
    await page.goto("/e2e/www/viewer.html"); // the host app is already open
    await context.setOffline(true);
    const problems = collectProblems(page);
    const result = await page.evaluate(async (data) => {
      const v = document.getElementById("v") as HTMLElement & {
        load(b: Uint8Array): Promise<void>;
      };
      let error: string | undefined;
      v.addEventListener("flexova-error", (e) => (error = (e as CustomEvent).detail.code));
      await v.load(new Uint8Array(data));
      const imgs = [...(v.shadowRoot?.querySelectorAll("img") ?? [])];
      const decoded = await Promise.all(
        imgs.map((i) =>
          i.decode().then(
            () => true,
            () => false,
          ),
        ),
      );
      return {
        error,
        figures: v.shadowRoot?.querySelectorAll("figure").length,
        images: imgs.length > 0 && decoded.every(Boolean),
      };
    }, bytes);
    expect({ error: result.error, figures: result.figures }).toEqual({
      error: undefined,
      figures: 2,
    });
    // WebKit loads blob: URLs through its network process, which Playwright's offline emulation shuts off
    // (Safari really offline still loads them), so images are decoded offline only in the other engines.
    if (browserName !== "webkit") expect(result.images).toBe(true);
    expect(problems).toEqual([]);
  });
});

test.describe("hostile and invalid packages", () => {
  for (const rel of rejectedFixtures()) {
    test(rel, async ({ page }) => {
      const problems = collectProblems(page);
      const outcome = await open(page, rel);
      expect(outcome.ok === true || typeof outcome.detail.code === "string").toBe(true);
      const found = await page.evaluate(() => {
        const root = document.getElementById("v")?.shadowRoot;
        if (!root) return ["no shadow root"];
        const bad: string[] = [];
        const styles = root.querySelectorAll("style");
        if (styles.length > 1) bad.push("extra <style>");
        for (const el of root.querySelectorAll("*")) {
          const name = el.localName;
          if (
            [
              "script",
              "iframe",
              "object",
              "embed",
              "form",
              "input",
              "base",
              "svg",
              "link",
              "meta",
              "template",
            ].includes(name)
          )
            bad.push(`<${name}>`);
          for (const a of el.attributes) {
            if (/^on/i.test(a.name) || a.name === "style" || a.name === "srcdoc")
              bad.push(`${name}[${a.name}]`);
            if (["src", "srcset"].includes(a.name) && !a.value.startsWith("blob:"))
              bad.push(`${name}[${a.name}=${a.value.slice(0, 40)}]`);
            if (a.name === "href" && /^\s*(javascript|data|vbscript):/i.test(a.value))
              bad.push(`${name}[href=${a.value}]`);
          }
        }
        return bad;
      });
      expect(found).toEqual([]);
      expect(problems).toEqual([]);
    });
  }
});

test.describe("accessibility (axe, WCAG 2.2 AA)", () => {
  for (const rel of SHOWCASE) {
    for (const scheme of THEMES) {
      test(`${rel} ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        expect((await open(page, rel)).ok).toBe(true);
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        expect(
          results.violations.map(
            (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
          ),
        ).toEqual([]);
      });
    }
  }
});
