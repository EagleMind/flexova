// The plain HTML example must keep working: open a file, show its contents, navigate, switch theme.
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { CONFORMANCE } from "./fixtures";

test("plain-html example opens a document from disk", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/examples/plain-html/index.html");
  await page.setInputFiles("#file", fileURLToPath(new URL("valid/links.flexova", CONFORMANCE)));
  await expect(page.locator("#title")).toHaveText("Flexova conformance fixture");
  await expect(page.locator("#toc li")).toHaveCount(3);
  await expect(page.locator("flexova-viewer h1").first()).toHaveText("Part A");
  await page.locator("#toc a", { hasText: "Part 3" }).click();
  await page.selectOption("#theme", "dark");
  await expect(page.locator("flexova-viewer")).toHaveCSS("background-color", "rgb(18, 18, 18)");
  await page.setInputFiles(
    "#file",
    fileURLToPath(new URL("hostile/sealed-level.flexova", CONFORMANCE)),
  );
  await expect(page.locator("#title")).toContainText("sealed");
  expect(errors).toEqual([]);
});
