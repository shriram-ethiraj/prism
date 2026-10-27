import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
for (const resolution of ["1080p", "2160p"]) {
  test(`${resolution} unsigned widget loads offline and preserves wallpaper/preferences`, async ({
    browser,
  }) => {
    const entries = unzipSync(
      readFileSync(
        new URL(
          `../packages/Prism-${version}-${resolution}-unsigned.wgt`,
          import.meta.url,
        ),
      ),
    );
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      offline: true,
    });
    const missing: string[] = [],
      errors: string[] = [],
      images: string[] = [];
    try {
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        const path = decodeURIComponent(url.pathname.slice(1)) || "index.html";
        const data = entries[path];
        if (url.hostname !== "prism.test" || !data) {
          missing.push(path);
          await route.abort();
          return;
        }
        if (/wallpapers\/.*\.jpg$/.test(path)) images.push(path);
        const ext = path.split(".").pop();
        const contentType =
          (
            {
              html: "text/html",
              js: "application/javascript",
              css: "text/css",
              jpg: "image/jpeg",
              png: "image/png",
              svg: "image/svg+xml",
              woff2: "font/woff2",
            } as Record<string, string>
          )[ext!] || "application/octet-stream";
        await route.fulfill({ body: Buffer.from(data), contentType });
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("http://prism.test/index.html");
      await expect(page.locator(".home .app-art.has-image")).toHaveCount(3);
      await expect(page.locator("#wallpaper")).toHaveCSS(
        "background-image",
        /w002\.jpg/,
      );
      expect(images.filter((x) => !x.endsWith("-frost.jpg"))).toEqual([
        "wallpapers/w002.jpg",
      ]);
      await page.locator('[data-focus="settings"]').click();
      await page.locator('[data-focus="category:wallpaper"]').focus();
      await expect(page.locator(".wallpaper-option")).toHaveCount(50);
      expect(
        await page
          .locator(".wallpaper-thumb img")
          .evaluateAll((nodes) =>
            nodes.every((n) => n.getAttribute("loading") === "lazy"),
          ),
      ).toBe(true);
      await page.locator('[data-focus="wallpaper:w001"]').click();
      await page.locator('[data-focus="preview-apply"]').click();
      await expect(page.locator("#wallpaper")).toHaveCSS(
        "background-image",
        /w001\.jpg/,
      );
      const saved = await page.evaluate(() =>
        localStorage.getItem("prizen.preferences.v1"),
      );
      await page.reload();
      await expect(page.locator("#wallpaper")).toHaveCSS(
        "background-image",
        /w001\.jpg/,
      );
      expect(
        await page.evaluate(() =>
          localStorage.getItem("prizen.preferences.v1"),
        ),
      ).toBe(saved);
      expect(missing).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
