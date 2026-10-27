import { test, expect, type Page } from "@playwright/test";
import { nativeSurface } from "../src/surface";
const item = (p: Page, id: string) => p.locator(`[data-focus="${id}"]`);

for (const surface of [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
]) {
  test(`reviewed native surface ${surface.width} fits Home, menu and Settings despite inflated viewport metrics`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: surface });
    try {
      await context.addInitScript(() => {
        window.tizen = {
          application: {
            getAppsInfo: (ok) => ok([]),
            launch: (_id, ok) => ok(),
          },
          systeminfo: {
            getPropertyValue: (_key, ok) =>
              ok({ connected: [{ type: "DP", number: 1 }], disconnected: [] }),
          },
          tvwindow: { setSource: (_source, ok) => ok() },
        };
        Object.defineProperty(window, "innerWidth", {
          value: 6000,
          configurable: true,
        });
        Object.defineProperty(window, "visualViewport", {
          value: { width: 6000, height: 4000 },
          configurable: true,
        });
      });
      const p = await context.newPage();
      await p.route("**/device-profile.js", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: `window.PRISM_SURFACE=${JSON.stringify(surface)};`,
        }),
      );
      await p.goto("/");
      expect(await p.locator("#stage").boundingBox()).toEqual({
        x: 0,
        y: 0,
        ...surface,
      });
      const contained = async (selector: string) => {
        const bounds = await p.locator(selector).boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(-1);
        expect(bounds!.y).toBeGreaterThanOrEqual(-1);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
          surface.width + 1,
        );
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
          surface.height + 1,
        );
      };
      await contained(".home");
      await contextMenu(p, "input:DP:1");
      await contained(".context-panel");
      await p.keyboard.press("Escape");
      await item(p, "settings").click();
      await contained(".settings-page");
      await item(p, "category:wallpaper").focus();
      await contained(".wallpaper-option:first-child");
    } finally {
      await context.close();
    }
  });
}

test("invalid native surface configuration falls back to the reference logical size", () => {
  for (const value of [
    null,
    {},
    { width: 6000, height: 4000 },
    { width: "1280", height: 720 },
  ])
    expect(nativeSurface(value)).toEqual({ width: 1920, height: 1080 });
});

for (const cached of [false, true]) {
  test(`startup ${cached ? "renders the saved catalog immediately" : "shows loading rather than an empty setup prompt"} before discovery resolves`, async ({
    browser,
  }) => {
    const nativeContext = await browser.newContext();
    try {
      await nativeContext.addInitScript(
        ({ cached }) => {
          const key = "prism.catalog.v1";
          if (cached)
            localStorage.setItem(
              key,
              JSON.stringify({
                version: 1,
                apps: [
                  {
                    id: "example.Saved",
                    name: "Saved app",
                    iconPath: "./preview-icons/youtube.svg",
                  },
                ],
                inputs: [{ type: "DP", number: 1 }],
              }),
            );
          window.tizen = {
            application: {
              getAppsInfo: (ok) =>
                window.addEventListener(
                  "resolve-discovery",
                  () =>
                    ok(
                      cached
                        ? [
                            {
                              id: "example.Fresh",
                              name: "Fresh app",
                              iconPath: "./preview-icons/apple.svg",
                            },
                          ]
                        : [],
                    ),
                  { once: true },
                ),
              launch: (_id, ok) => ok(),
            },
            systeminfo: {
              getPropertyValue: (_key, ok) =>
                window.addEventListener(
                  "resolve-discovery",
                  () =>
                    ok(
                      cached
                        ? {
                            connected: [{ type: "HDMI", number: 1 }],
                            disconnected: [],
                          }
                        : { connected: [], disconnected: [] },
                    ),
                  { once: true },
                ),
            },
            tvwindow: { setSource: (_source, ok) => ok() },
          };
        },
        { cached },
      );
      const p = await nativeContext.newPage();
      await p.goto("/");
      await expect(item(p, "setup")).toHaveCount(0);
      if (cached) {
        await expect(item(p, "app:example.Saved")).toBeVisible();
        await expect(item(p, "input:DP:1")).toBeVisible();
        await expect(
          p.getByRole("img", { name: "Refreshing signal status" }),
        ).toBeVisible();
        await item(p, "app:example.Saved").focus();
      } else {
        await expect(
          p
            .getByRole("status", { name: "" })
            .filter({ hasText: "Loading apps and inputs" }),
        ).toBeVisible();
      }
      await p.evaluate(() =>
        window.dispatchEvent(new Event("resolve-discovery")),
      );
      if (cached) {
        await expect(item(p, "app:example.Saved")).toHaveCount(0);
        await expect(item(p, "input:DP:1")).toHaveCount(0);
        await expect(item(p, "app:example.Fresh")).toBeVisible();
        await expect(item(p, "input:HDMI:1")).toBeVisible();
        await expect(
          p.getByRole("img", { name: "Signal detected", exact: true }),
        ).toBeVisible();
        const stored = await p.evaluate(() =>
          JSON.parse(localStorage.getItem("prism.catalog.v1")!),
        );
        expect(stored.apps[0].id).toBe("example.Fresh");
        expect(stored.inputs[0]).toEqual({ type: "HDMI", number: 1 });
      } else {
        await expect(item(p, "setup")).toBeVisible();
        await expect(
          p.getByText("Loading apps and inputs…", { exact: true }),
        ).toHaveCount(0);
      }
    } finally {
      await nativeContext.close();
    }
  });
}
async function category(p: Page, id: string): Promise<void> {
  await item(p, "settings").click();
  await item(p, `category:${id}`).focus();
}
async function contextMenu(p: Page, id: string): Promise<void> {
  await item(p, id).focus();
  await p.keyboard.down("Enter");
  await p.waitForTimeout(650);
  await p.keyboard.up("Enter");
  await expect(item(p, "item-move")).toBeFocused();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(item(page, "input:DP:1")).toBeFocused();
});
for (const trigger of ["remote Home", "native Home request"]) {
  const home = async (page: Page) => {
    if (trigger === "remote Home") await page.keyboard.press("Home");
    else
      await page.evaluate(() => window.dispatchEvent(new Event("appcontrol")));
  };
  test(`${trigger} returns directly from Settings and dialogs without saving drafts`, async ({
    page,
  }) => {
    await category(page, "layout");
    await item(page, "setting:order").click();
    await home(page);
    await expect(page.locator(".home")).toBeVisible();
    await expect(page.locator("#dialog-host")).toBeEmpty();
    await expect(item(page, "settings")).toBeFocused();

    await category(page, "wallpaper");
    await item(page, "wallpaper:w001").click();
    await home(page);
    await expect(page.locator(".home")).toBeVisible();
    await expect(page.locator("#wallpaper")).toHaveCSS(
      "background-image",
      /w002/,
    );

    await contextMenu(page, "input:DP:1");
    await item(page, "item-label").click();
    await page.locator("#input-label").fill("Unsaved label");
    await home(page);
    await expect(page.locator("#dialog-host")).toBeEmpty();
    await expect(item(page, "input:DP:1")).toHaveAttribute(
      "aria-label",
      "DisplayPort 1",
    );
    await expect(item(page, "input:DP:1")).toBeFocused();

    await item(page, "all-apps").click();
    await home(page);
    await expect(page.locator(".home")).toBeVisible();
  });
  test(`${trigger} cancels a pending OK and an unsaved tile move`, async ({
    page,
  }) => {
    await page.keyboard.down("Enter");
    await home(page);
    await page.keyboard.up("Enter");
    await expect(page.locator("#toast")).not.toHaveClass(/show/);
    await contextMenu(page, "input:DP:1");
    await item(page, "item-move").click();
    await page.keyboard.press("ArrowRight");
    await home(page);
    await expect(page.locator(".moving-slot")).toHaveCount(0);
    await expect(
      page.locator('[data-shelf="inputs"] .card').first(),
    ).toHaveAttribute("data-id", "DP:1");
  });
}
for (const trigger of ["visibility resume", "window focus", "page restore"]) {
  test(`native ${trigger} returns from Settings without an appcontrol or Home key`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.tizen = {
        application: {
          getAppsInfo: (ok) => ok([]),
          launch: (_id, ok) => ok(),
        },
        systeminfo: {
          getPropertyValue: (_key, ok) =>
            ok({ connected: [{ type: "DP", number: 1 }], disconnected: [] }),
        },
        tvwindow: { setSource: (_source, ok) => ok() },
      };
    });
    await page.reload();
    await expect(item(page, "input:DP:1")).toBeFocused();
    await category(page, "layout");
    await item(page, "setting:order").click();
    await page.keyboard.down("Enter");
    await page.evaluate((trigger) => {
      if (trigger === "visibility resume") {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: false,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      } else if (trigger === "window focus") {
        window.dispatchEvent(new Event("blur"));
        window.dispatchEvent(new Event("focus"));
      } else {
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        );
      }
    }, trigger);
    await page.keyboard.up("Enter");
    await expect(page.locator(".home")).toBeVisible();
    await expect(page.locator("#dialog-host")).toBeEmpty();
    await expect(item(page, "settings")).toBeFocused();
    await expect(page.locator("#toast")).not.toHaveClass(/show/);
  });
}

test("Back returns directly to Home from Settings detail, categories and All Apps", async ({
  page,
}) => {
  await category(page, "system");
  await item(page, "setting:refresh").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".home")).toBeVisible();

  await category(page, "layout");
  await page.keyboard.press("Escape");
  await expect(page.locator(".home")).toBeVisible();

  await item(page, "all-apps").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".home")).toBeVisible();
});

test("browser tab focus and visibility changes preserve Settings drafts", async ({
  page,
}) => {
  await category(page, "layout");
  await item(page, "setting:order").click();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".settings-page")).toBeVisible();
  await expect(page.locator("#dialog-host .section-panel")).toBeVisible();
});

test("square artwork tiles fit Home without branding or an extra glass frame", async ({
  page,
}) => {
  await expect(page.locator(".home .app-art.has-image")).toHaveCount(3);
  const layout = await page.locator(".home .card-face").evaluateAll((nodes) =>
    nodes.map((n) => ({
      width: (n as HTMLElement).offsetWidth,
      height: (n as HTMLElement).offsetHeight,
      bottom: n.getBoundingClientRect().bottom,
    })),
  );
  expect(
    layout.every((r) => r.width === 224 && r.height === 224 && r.bottom < 1040),
  ).toBeTruthy();
  await expect(page.locator(".app-face.frost")).toHaveCount(0);
  await expect(page.locator(".brand")).toHaveCount(0);
  await expect(
    item(page, "input:DP:1").locator(".input-copy strong"),
  ).toHaveText("DisplayPort 1");
  await expect(
    item(page, "input:DP:1").locator(".input-copy small"),
  ).toHaveCount(0);
  await expect(
    item(page, "input:HDMI:1").locator(".input-copy strong"),
  ).toHaveText("HDMI 1");
  await expect(
    item(page, "input:HDMI:1").locator(".input-copy small"),
  ).toHaveCount(0);
  await expect(page.locator("#focus-plate")).toHaveCount(0);
});
test("Home edge routes and vertical moves use nearest geometry", async ({
  page,
}) => {
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "input:DP:1")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "native-home")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "input:HDMI:2")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "native-home")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "all-apps")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "native-home")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "input:HDMI:2")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(item(page, "native-home")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "input:HDMI:2")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "app:preview.apple")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(item(page, "input:HDMI:2")).toBeFocused();
  await item(page, "input:DP:1").focus();
  await page.keyboard.press("ArrowUp");
  await expect(item(page, "native-home")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "input:HDMI:2")).toBeFocused();
});
test("right edge uses the first available top control when Samsung Home is hidden", async ({
  page,
}) => {
  await page.evaluate(() => {
    const key = "prizen.preferences.v1";
    const prefs = JSON.parse(localStorage.getItem(key)!);
    prefs.samsungHome = false;
    localStorage.setItem(key, JSON.stringify(prefs));
  });
  await page.reload();
  await item(page, "input:HDMI:2").focus();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "all-apps")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "input:HDMI:2")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "all-apps")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "input:HDMI:2")).toBeFocused();
});

test("Left from a top control uses nearest geometry without a remembered origin", async ({
  page,
}) => {
  await item(page, "native-home").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "input:HDMI:2")).toBeFocused();
});

test("Left from the header follows actual input and section order", async ({
  page,
}) => {
  await page.evaluate(() => {
    const key = "prizen.preferences.v1";
    const prefs = JSON.parse(localStorage.getItem(key)!);
    prefs.inputOrder = ["HDMI:1", "HDMI:2", "DP:1"];
    localStorage.setItem(key, JSON.stringify(prefs));
  });
  await page.reload();
  await item(page, "native-home").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "input:DP:1")).toBeFocused();

  await page.evaluate(() => {
    const key = "prizen.preferences.v1";
    const prefs = JSON.parse(localStorage.getItem(key)!);
    prefs.homeOrder = ["apps", "inputs"];
    localStorage.setItem(key, JSON.stringify(prefs));
  });
  await page.reload();
  await item(page, "native-home").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "app:preview.apple")).toBeFocused();
});

test("long shelves use visible alignment and All Apps continues onto the next row", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.tizen = {
      application: {
        getAppsInfo: (ok) =>
          ok(
            Array.from({ length: 13 }, (_, i) => ({
              id: `example.App${i}`,
              name: `App ${String(i).padStart(2, "0")}`,
              iconPath: "./preview-icons/youtube.svg",
            })),
          ),
        launch: (_id, ok) => ok(),
      },
      systeminfo: {
        getPropertyValue: (_key, ok) =>
          ok({ connected: [{ type: "DP", number: 1 }], disconnected: [] }),
      },
      tvwindow: { setSource: (_source, ok) => ok() },
    };
  });
  await page.reload();
  await expect(page.locator('[data-shelf="apps"] .card')).toHaveCount(13);
  await item(page, "app:example.App12").focus();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "all-apps")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "app:example.App12")).toBeFocused();
  await item(page, "all-apps").click();
  await item(page, "app:example.App5").focus();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "app:example.App6")).toBeFocused();
  await item(page, "app:example.App11").focus();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "app:example.App12")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "all-back")).toBeFocused();
});

test("Settings categories update immediately and preserve rail DOM; Left works in Home layout", async ({
  page,
}) => {
  await category(page, "layout");
  await page.evaluate(() => {
    document
      .querySelector('[data-focus="category:layout"]')!
      .setAttribute("data-stable", "yes");
  });
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".detail-heading h2")).toHaveText("Apps");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".detail-heading h2")).toHaveText("Home layout");
  await expect(item(page, "category:layout")).toHaveAttribute(
    "data-stable",
    "yes",
  );
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "setting:order")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "category:layout")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await expect(item(page, "settings-close")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "setting:order")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await expect(item(page, "settings")).toBeFocused();
});
test("Spatial fallback covers Settings rows and the All Apps header", async ({
  page,
}) => {
  await category(page, "wallpaper");
  await item(page, "wallpaper:w001").focus();
  await page.keyboard.press("ArrowUp");
  await expect(item(page, "setting:wallpaper-mode")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "wallpaper:w002")).toBeFocused();
  await item(page, "settings-close").click();
  await item(page, "all-apps").click();
  await item(page, "all-back").focus();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "app:preview.apple")).toBeFocused();
});

test("Popups keep D-pad focus inside the active layer", async ({ page }) => {
  await contextMenu(page, "input:DP:1");
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    await page.keyboard.press(key);
    await expect(page.locator("#dialog-host [data-focus]:focus")).toHaveCount(
      1,
    );
  }
  await page.keyboard.press("Escape");
  await expect(item(page, "input:DP:1")).toBeFocused();

  await category(page, "layout");
  await item(page, "setting:clock-format").click();
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    await page.keyboard.press(key);
    await expect(page.locator("#dialog-host [data-focus]:focus")).toHaveCount(
      1,
    );
  }
  await page.keyboard.press("Escape");
  await expect(item(page, "setting:clock-format")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".home")).toBeVisible();
});

test("Apps and Inputs toggle directly, including disconnected inputs, without losing focus", async ({
  page,
}) => {
  await category(page, "inputs");
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "manage:DP:1")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(item(page, "manage:DP:1")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(item(page, "manage:DP:1")).toBeFocused();
  await expect(page.locator(".dialog-panel")).toHaveCount(0);
  await expect(page.locator(".chips,.visibility-status")).toHaveCount(0);
  await item(page, "settings-close").click();
  await expect(item(page, "input:DP:1")).toHaveCount(0);
  await expect(item(page, "input:HDMI:2")).toBeVisible();
  await category(page, "inputs");
  await item(page, "manage:DP:1").click();
  await item(page, "settings-close").click();
  await expect(item(page, "input:DP:1")).toBeVisible();
  await category(page, "apps");
  await item(page, "manage:preview.youtube").click();
  await item(page, "settings-close").click();
  await expect(item(page, "app:preview.youtube")).toHaveCount(0);
});
test("one tile size and five simple categories persist across legacy preferences", async ({
  page,
}) => {
  await category(page, "layout");
  await expect(page.locator(".category")).toHaveCount(5);
  await expect(item(page, "setting:density")).toHaveCount(0);
  await expect(item(page, "category:appearance")).toHaveCount(0);
  await item(page, "setting:order").click();
  await item(page, "section-up:apps").click();
  await item(page, "sections-save").click();
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem("prizen.preferences.v1")!);
    Object.assign(prefs, {
      density: "compact",
      material: "matte",
      reducedMotion: true,
      highContrast: true,
    });
    localStorage.setItem("prizen.preferences.v1", JSON.stringify(prefs));
  });
  await page.reload();
  await expect(page.locator(".shelf").first()).toHaveAttribute(
    "data-shelf",
    "apps",
  );
  expect(
    await page
      .locator(".card-face")
      .first()
      .evaluate((el) => (el as HTMLElement).offsetWidth),
  ).toBe(224);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".card.focused")).toHaveAttribute(
    "data-group",
    "inputs",
  );
});
test("short press activates only on release; long hold opens only Move and Hide", async ({
  page,
}) => {
  await item(page, "app:preview.apple").focus();
  await page.keyboard.down("Enter");
  await page.waitForTimeout(100);
  await expect(page.locator("#toast")).not.toHaveClass(/show/);
  await page.keyboard.up("Enter");
  await expect(page.locator("#toast")).toContainText("Preview: app launching");
  await page.reload();
  await contextMenu(page, "app:preview.youtube");
  await expect(page.locator(".dialog-option")).toHaveText(["Move", "Hide"]);
  await expect(page.locator("#toast")).not.toHaveClass(/show/);
  await page.keyboard.press("Escape");
  await expect(item(page, "app:preview.youtube")).toBeFocused();
});
test("Home move cancels or saves within its shelf, and Hide can be reversed in Settings", async ({
  page,
}) => {
  await contextMenu(page, "input:DP:1");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator('[data-shelf="inputs"] .card').first(),
  ).toHaveAttribute("data-id", "HDMI:1");
  await page.keyboard.press("Escape");
  await expect(
    page.locator('[data-shelf="inputs"] .card').first(),
  ).toHaveAttribute("data-id", "DP:1");
  await contextMenu(page, "input:DP:1");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "input:DP:1")).toBeFocused();
  await page.keyboard.press("Enter");
  await page.reload();
  await expect(
    page.locator('[data-shelf="inputs"] .card').nth(1),
  ).toHaveAttribute("data-id", "DP:1");
  await contextMenu(page, "input:DP:1");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(item(page, "input:DP:1")).toHaveCount(0);
  await category(page, "inputs");
  await item(page, "manage:DP:1").click();
  await item(page, "settings-close").click();
  await expect(item(page, "input:DP:1")).toBeVisible();
});
test("navigation cancels a pending hold and cannot launch the old card", async ({
  page,
}) => {
  await page.keyboard.down("Enter");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(650);
  await page.keyboard.up("Enter");
  await expect(page.locator(".dialog-panel")).toHaveCount(0);
  await expect(page.locator("#toast")).not.toHaveClass(/show/);
  await expect(item(page, "input:HDMI:1")).toBeFocused();
});
test("wallpaper gallery previews full-size files, cancels and applies; rotation has no categories", async ({
  page,
}) => {
  await category(page, "wallpaper");
  await expect(page.locator(".wallpaper-option")).toHaveCount(50);
  await expect(page.locator(".gallery-filters,.wallpaper-summary")).toHaveCount(
    0,
  );
  await item(page, "wallpaper:w001").click();
  await expect(page.locator(".wallpaper-preview")).toHaveCSS(
    "background-image",
    /w001\.jpg/,
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".preview-title")).toHaveText(
    "Star Trails at La Hague",
  );
  await page.keyboard.press("Escape");
  await expect(item(page, "wallpaper:w002")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await item(page, "wallpaper:w023").click();
  await item(page, "preview-apply").click();
  await expect(item(page, "wallpaper:w023")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await item(page, "setting:wallpaper-mode").click();
  await item(page, "setting:rotation").click();
  await item(page, "option:2").click();
  await expect(item(page, "setting:rotation")).toContainText("30 minutes");
  await page.reload();
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w023\.jpg/,
  );
});
test("wallpaper grid first column returns to rail; all controls fit at 720p", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await category(page, "wallpaper");
  await item(page, "wallpaper:w001").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(item(page, "category:wallpaper")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "wallpaper:w001")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(item(page, "setting:wallpaper-mode")).toBeFocused();
  await page.screenshot({ path: "test-results/settings-720p.png" });
  await item(page, "wallpaper:w001").focus();
  for (let row = 0; row < 12; row++) await page.keyboard.press("ArrowDown");
  await expect(item(page, "wallpaper:w049")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "wallpaper:w050")).toBeFocused();
  const last = await item(page, "wallpaper:w050").boundingBox();
  expect(last!.y).toBeGreaterThanOrEqual(0);
  expect(last!.y + last!.height).toBeLessThanOrEqual(720);
  await page.keyboard.press("Enter");
  await expect(page.locator(".preview-title")).toHaveText("Fedora 34 · Night");
  await page.keyboard.press("Escape");
  await expect(item(page, "wallpaper:w050")).toBeFocused();
});
test("retired wallpaper selection migrates without resetting Home customizations", async ({
  page,
}) => {
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("prizen.preferences.v1") || "{}");
    Object.assign(p, {
      wallpaper: "midnight",
      wallpaperMode: "rotate",
      rotationMinutes: 30,
      homeOrder: ["apps", "inputs"],
      appOrder: ["preview.prime", "preview.youtube"],
      apps: { "preview.prime": { visible: false, label: "My films" } },
      inputs: {
        "DP:1": { visible: true, label: "My desktop", symbol: "laptop" },
      },
    });
    localStorage.setItem("prizen.preferences.v1", JSON.stringify(p));
  });
  await page.reload();
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w002\.jpg/,
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("prizen.preferences.v1") || "{}"),
  );
  expect(saved.wallpaper).toBe("w002");
  expect(saved.wallpaperMode).toBe("rotate");
  expect(saved.rotationMinutes).toBe(30);
  expect(saved.homeOrder).toEqual(["apps", "inputs"]);
  expect(saved.appOrder).toEqual(["preview.prime", "preview.youtube"]);
  expect(saved.apps["preview.prime"]).toEqual({
    visible: false,
    label: "My films",
  });
  expect(saved.inputs["DP:1"]).toEqual({
    visible: true,
    label: "My desktop",
    symbol: "laptop",
  });
});
test("empty Home remains recoverable and legacy hidden-port filtering is retired", async ({
  page,
}) => {
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("prizen.preferences.v1") || "{}");
    p.showDisconnected = false;
    p.collection = "Mountains";
    p.wallpaper = "alpine-lake";
    p.inputs = {
      "DP:1": { visible: false },
      "HDMI:1": { visible: false },
      "HDMI:2": { visible: false },
    };
    p.apps = Object.fromEntries(
      ["apple", "youtube", "prime", "netflix", "missing"].map(
        (id) => ["preview." + id, { visible: false }],
      ),
    );
    localStorage.setItem("prizen.preferences.v1", JSON.stringify(p));
  });
  await page.reload();
  await expect(item(page, "setup")).toBeVisible();
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w002/,
  );
  await item(page, "setup").click();
  await item(page, "category:inputs").focus();
  await item(page, "manage:HDMI:2").click();
  await item(page, "settings-close").click();
  await expect(item(page, "input:HDMI:2")).toBeVisible();
});
test("native source identity, discovered artwork and overflow-safe viewport remain intact", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  await context.addInitScript(() => {
    const source = { type: "HDMI", number: 1 };
    window.tizen = {
      application: {
        getAppsInfo: (ok) =>
          ok([
            {
              id: "example.Video",
              name: "Video",
              iconPath: "./preview-icons/youtube.svg",
              show: true,
            },
          ]),
        launch: (_id, ok) => ok(),
      },
      systeminfo: {
        getPropertyValue: (_key, ok) =>
          ok({ connected: [source], disconnected: [] }),
      },
      tvwindow: {
        setSource: (value, ok) => {
          if (value !== source) throw new Error("Native descriptor lost");
          document.body.dataset.sourceSwitch = "success";
          ok();
        },
      },
    };
    Object.defineProperty(window, "innerWidth", {
      value: 2880,
      configurable: true,
    });
    Object.defineProperty(window, "visualViewport", {
      value: { width: 2400, height: 1350 },
      configurable: true,
    });
  });
  const p = await context.newPage();
  await p.route("**/device-artwork.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: 'window.PRISM_ARTWORK={"example.Video":["./preview-icons/youtube.svg"]};',
    }),
  );
  await p.goto("http://127.0.0.1:8765/");
  await expect(
    item(p, "app:example.Video").locator(".has-image img"),
  ).toHaveAttribute("src", "./preview-icons/youtube.svg");
  expect(await p.locator("#stage").boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  await item(p, "input:HDMI:1").focus();
  await p.evaluate(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Unidentified",
        keyCode: 13,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Unidentified",
        keyCode: 13,
        bubbles: true,
      }),
    );
  });
  await expect(p.locator("body")).toHaveAttribute(
    "data-source-switch",
    "success",
  );
  await context.close();
});

test("input switching announces the label and port, then clears after 3.5 seconds", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  await context.addInitScript(() => {
    window.tizen = {
      application: {
        getAppsInfo: (ok) => ok([]),
        launch: (_id, ok) => ok(),
      },
      systeminfo: {
        getPropertyValue: (_key, ok) =>
          ok({ connected: [{ type: "DP", number: 1 }], disconnected: [] }),
      },
      tvwindow: { setSource: (_source, ok) => ok() },
    };
  });
  const p = await context.newPage();
  await p.goto("/");
  await expect(item(p, "input:DP:1")).toBeFocused();
  await p.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  // Freeze time before activation so click/assertion time cannot age the toast.
  await p.clock.pauseAt(new Date("2026-01-01T00:01:00Z"));
  await item(p, "input:DP:1").click();
  const toast = p.locator("#toast");
  await expect(toast).toContainText("Switching to DisplayPort 1…");
  await expect(toast).toHaveAttribute("data-tone", "progress");
  await expect(toast).toHaveClass(/show/);
  await p.clock.fastForward(3499);
  await expect(toast).toHaveClass(/show/);
  await p.clock.fastForward(1);
  await expect(toast).not.toHaveClass(/show/);
  await context.close();
});

test("manual refresh keeps progress visible until discovery settles", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  await context.addInitScript(() => {
    let appCalls = 0,
      sourceCalls = 0;
    window.tizen = {
      application: {
        getAppsInfo: (ok) => {
          if (++appCalls === 1) ok([]);
          else
            window.addEventListener("resolve-refresh-apps", () => ok([]), {
              once: true,
            });
        },
        launch: (_id, ok) => ok(),
      },
      systeminfo: {
        getPropertyValue: (_key, ok) => {
          const value = {
            connected: [{ type: "DP", number: 1 }],
            disconnected: [],
          };
          if (++sourceCalls === 1) ok(value);
          else
            window.addEventListener(
              "resolve-refresh-sources",
              () => ok(value),
              { once: true },
            );
        },
      },
      tvwindow: { setSource: (_source, ok) => ok() },
    };
  });
  const p = await context.newPage();
  await p.goto("/");
  await expect(item(p, "input:DP:1")).toBeFocused();
  await p.clock.install();
  await category(p, "system");
  await item(p, "setting:refresh").click();
  const toast = p.locator("#toast");
  await expect(toast).toContainText("Refreshing apps and inputs…");
  await expect(toast).toHaveAttribute("data-tone", "progress");
  await expect(toast).toHaveClass(/show/);
  await p.clock.fastForward(5000);
  await expect(toast).toHaveClass(/show/);
  await expect(toast).toContainText("Refreshing apps and inputs…");
  await p.evaluate(() => {
    window.dispatchEvent(new Event("resolve-refresh-apps"));
    window.dispatchEvent(new Event("resolve-refresh-sources"));
  });
  await expect(toast).toContainText("Apps and inputs refreshed.");
  await expect(toast).toHaveAttribute("data-tone", "success");
  await p.clock.fastForward(3500);
  await expect(toast).not.toHaveClass(/show/);
  await context.close();
});

test("rotation waits its interval and pauses in Settings and card editing", async ({
  page,
}) => {
  await page.clock.install();
  await page.reload();
  await expect(item(page, "input:DP:1")).toBeFocused();
  await category(page, "wallpaper");
  await item(page, "setting:wallpaper-mode").click();
  await item(page, "setting:rotation").click();
  await item(page, "option:0").click();
  await page.clock.fastForward(310000);
  await expect(item(page, "wallpaper:w002")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await item(page, "settings-close").click();
  await page.clock.fastForward(310000);
  await expect
    .poll(() =>
      page
        .locator("#wallpaper")
        .evaluate((el) => (el as HTMLElement).style.backgroundImage),
    )
    .toContain("w003");
  await item(page, "input:DP:1").focus();
  await page.keyboard.down("Enter");
  await page.clock.runFor(650);
  await page.keyboard.up("Enter");
  await item(page, "item-move").click();
  await page.clock.fastForward(310000);
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w003/,
  );
  await page.keyboard.press("Escape");
});

test("light raised border preserves dark surfaces with stationary neighbors", async ({
  page,
}) => {
  await item(page, "input:HDMI:1").focus();
  await page.waitForTimeout(200);
  const geometry = await item(page, "input:HDMI:1")
    .locator(".card-face")
    .boundingBox();
  expect(geometry!.width).toBeGreaterThan(248);
  expect(
    await item(page, "input:DP:1").evaluate((el) =>
      el.style.getPropertyValue("--shift-x"),
    ),
  ).toBe("");
  expect(
    await item(page, "input:HDMI:2").evaluate((el) =>
      el.style.getPropertyValue("--shift-x"),
    ),
  ).toBe("");
  await item(page, "settings").focus();
  await page.waitForTimeout(200);
  const focusStyle = await item(page, "settings").evaluate((el) => ({
    text: getComputedStyle(el).color,
    surface: getComputedStyle(el, ":before").backgroundColor,
    border: getComputedStyle(el).borderTopWidth,
  }));
  expect(focusStyle).toEqual({
    text: "rgb(243, 247, 255)",
    surface: "rgb(34, 49, 73)",
    border: "0px",
  });
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  await expect(item(page, "setting:order")).toHaveCSS(
    "color",
    "rgb(243, 247, 255)",
  );
});
test("long press opens an anchored menu without a modal scrim; outside click dismisses only", async ({
  page,
}) => {
  await contextMenu(page, "input:HDMI:1");
  const panel = page.getByRole("menu", { name: "Tile actions" });
  await expect(panel.getByRole("menuitem")).toHaveText([
    "Move",
    "Hide",
    "Edit label",
  ]);
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  const face = await item(page, "input:HDMI:1")
    .locator(".card-face")
    .boundingBox();
  const popup = await panel.boundingBox();
  expect(popup!.width).toBe(240);
  expect(popup!.x).toBeGreaterThan(face!.x + face!.width);
  expect(popup!.y).toBeLessThan(face!.y + face!.height);
  await page.mouse.click(1850, 1030);
  await expect(panel).toHaveCount(0);
  await expect(item(page, "input:HDMI:1")).toBeFocused();
  await expect(page.locator("#toast")).not.toHaveClass(/show/);
});
test("menu stays inside a scaled viewport at the right edge and OS reduced motion keeps focus clear", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await contextMenu(page, "app:preview.apple");
  const popup = await page.getByRole("menu").boundingBox();
  expect(popup!.x).toBeGreaterThan(0);
  expect(popup!.x + popup!.width).toBeLessThan(1280);
  expect(popup!.y + popup!.height).toBeLessThan(720);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await item(page, "settings").focus();
  await expect(item(page, "settings")).toHaveCSS("color", "rgb(243, 247, 255)");
  const transform = await item(page, "settings").evaluate(
    (el) => getComputedStyle(el, ":before").transform,
  );
  expect(transform).toBe("none");
});

test("input labels edit from their context menu, cancel safely and persist escaped text", async ({
  page,
}) => {
  await contextMenu(page, "input:DP:1");
  await item(page, "item-label").click();
  await expect(page.locator("#input-label")).toBeFocused();
  await page.locator("#input-label").fill("Workstation");
  await page.keyboard.press("Escape");
  await expect(
    item(page, "input:DP:1").locator(".input-copy strong"),
  ).toHaveText("DisplayPort 1");
  await contextMenu(page, "input:DP:1");
  await item(page, "item-label").click();
  await page.locator("#input-label").fill("Work <&> play");
  await page.keyboard.press("Enter");
  await expect(
    item(page, "input:DP:1").locator(".input-copy strong"),
  ).toHaveText("Work <&> play");
  await expect(
    item(page, "input:DP:1").locator(".input-copy small"),
  ).toHaveText("DisplayPort 1");
  await page.reload();
  await expect(
    item(page, "input:DP:1").locator(".input-copy strong"),
  ).toHaveText("Work <&> play");
  await contextMenu(page, "input:DP:1");
  await item(page, "item-label").click();
  await page.locator("#input-label").fill("");
  await item(page, "label-save").click();
  await expect(
    item(page, "input:DP:1").locator(".input-copy strong"),
  ).toHaveText("DisplayPort 1");
  await expect(
    item(page, "input:DP:1").locator(".input-copy small"),
  ).toHaveCount(0);
});
test("reset restores defaults, clears input labels, and confirms with a toast", async ({
  page,
}) => {
  await page.evaluate(() => {
    const key = "prizen.preferences.v1";
    const prefs = JSON.parse(localStorage.getItem(key)!);
    prefs.inputs = { "DP:1": { visible: true, label: "Workstation" } };
    prefs.wallpaper = "w001";
    localStorage.setItem(key, JSON.stringify(prefs));
  });
  await page.reload();
  await expect(
    item(page, "input:DP:1").locator(".input-copy strong"),
  ).toHaveText("Workstation");
  await category(page, "system");
  await item(page, "setting:reset").click();
  await item(page, "confirm").click();
  await expect(page.locator(".home")).toBeVisible();
  await expect(page.locator("#toast")).toContainText(
    "Successfully reset all settings to default.",
  );
  await expect(page.locator("#toast")).toHaveAttribute("data-tone", "success");
  await expect(
    item(page, "input:DP:1").locator(".input-copy strong"),
  ).toHaveText("DisplayPort 1");
  await expect(
    item(page, "input:DP:1").locator(".input-copy small"),
  ).toHaveCount(0);
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w002/,
  );
});
test("a Home key exposed by the input device returns from Settings to Home", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  await context.addInitScript(() => {
    window.tizen = {
      application: {
        getAppsInfo: (ok) => ok([]),
        launch: (_id, ok) => ok(),
      },
      systeminfo: {
        getPropertyValue: (_key, ok) =>
          ok({ connected: [{ type: "DP", number: 1 }], disconnected: [] }),
      },
      tvwindow: { setSource: (_source, ok) => ok() },
      tvinputdevice: {
        registerKeyBatch: () => {},
        registerKey: () => {},
        getKey: (name: string) =>
          name === "Home" ? { name, code: 12345 } : null,
      },
    };
  });
  const p = await context.newPage();
  await p.goto("/");
  await expect(item(p, "input:DP:1")).toBeFocused();
  await item(p, "settings").click();
  await expect(p.locator(".settings-page")).toBeVisible();
  await p.evaluate(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Unidentified",
        keyCode: 12345,
        bubbles: true,
      }),
    ),
  );
  await expect(p.locator(".home")).toBeVisible();
  await context.close();
});
test("section order uses only arrow actions, supports cancellation and explicit saving", async ({
  page,
}) => {
  await category(page, "layout");
  await item(page, "setting:order").click();
  await expect(item(page, "section-down:inputs")).toBeFocused();
  await expect(page.locator(".section-name")).toHaveText(["Inputs", "Apps"]);
  await expect(
    page.locator('.section-row [data-action="section-pick"]'),
  ).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(item(page, "section-up:inputs")).toBeFocused();
  await page.keyboard.press("Escape");
  await item(page, "settings-close").click();
  await expect(page.locator(".shelf").first()).toHaveAttribute(
    "data-shelf",
    "inputs",
  );
  await category(page, "layout");
  await item(page, "setting:order").click();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "sections-save")).toBeFocused();
  await page.keyboard.press("Enter");
  await item(page, "settings-close").click();
  await expect(page.locator(".shelf").first()).toHaveAttribute(
    "data-shelf",
    "apps",
  );
  await page.reload();
  await expect(page.locator(".shelf").first()).toHaveAttribute(
    "data-shelf",
    "apps",
  );
});
test("cards have no external captions and input labels live inside their faces", async ({
  page,
}) => {
  await expect(page.locator(".card-label,.card-detail")).toHaveCount(0);
  await expect(
    item(page, "input:DP:1").locator(".card-face .input-copy strong"),
  ).toHaveText("DisplayPort 1");
  await expect(
    item(page, "input:DP:1").locator(".card-face .input-copy small"),
  ).toHaveCount(0);
  await expect(
    item(page, "app:preview.apple").locator(".input-copy"),
  ).toHaveCount(0);
  await item(page, "input:HDMI:1").focus();
  await page.waitForTimeout(200);
  const rects = await page
    .locator('[data-shelf="inputs"] .card-face')
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        left: n.getBoundingClientRect().left,
        right: n.getBoundingClientRect().right,
      })),
    );
  expect(rects[1].left - rects[0].right).toBeGreaterThan(35);
  expect(rects[2].left - rects[1].right).toBeGreaterThan(35);
});
test("moving cards interpolate to their slots and keep separate arrow controls inside the shelf", async ({
  page,
}) => {
  await contextMenu(page, "input:DP:1");
  await item(page, "item-move").click();
  const before = await item(page, "input:DP:1").boundingBox();
  const arrow = page.getByRole("button", { name: "Move left", exact: true });
  await expect(arrow).toBeDisabled();
  const face = await item(page, "input:DP:1")
    .locator(".card-face")
    .boundingBox();
  const left = await arrow.boundingBox();
  const window = await page
    .locator('[data-shelf="inputs"] .shelf-window')
    .boundingBox();
  expect(left!.x).toBeGreaterThanOrEqual(window!.x);
  expect(face!.x - (left!.x + left!.width)).toBeGreaterThan(10);
  await page.keyboard.press("ArrowRight");
  const active = await page
    .locator(".moving-slot")
    .evaluate((el) =>
      el.getAnimations().some((a) => a.playState === "running"),
    );
  expect(active).toBeTruthy();
  await page.waitForTimeout(70);
  const middle = await item(page, "input:DP:1").boundingBox();
  expect(middle!.x).toBeGreaterThan(before!.x + 10);
  expect(middle!.x).toBeLessThan(before!.x + 260);
  await page.waitForTimeout(200);
  const end = await item(page, "input:DP:1").boundingBox();
  expect(end!.x).toBeGreaterThan(before!.x + 265);
  const rightArrow = await page
    .getByRole("button", { name: "Move right", exact: true })
    .boundingBox();
  const neighbor = await item(page, "input:HDMI:2")
    .locator(".card-face")
    .boundingBox();
  expect(neighbor!.x - (rightArrow!.x + rightArrow!.width)).toBeGreaterThan(10);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await expect(
    page.locator('[data-shelf="inputs"] .card').first(),
  ).toHaveAttribute("data-id", "DP:1");
});
test("frost stays aligned with the wallpaper through focus, reorders and interrupted moves", async ({
  page,
}) => {
  // Check projected wallpaper coordinates, including a scaled stage and focus
  // enlargement, rather than just checking that background styles change.
  await page.setViewportSize({ width: 1280, height: 720 });
  const sampleMotion = async () =>
    page.evaluate(async () => {
      const samples: { error: number; moving: boolean; x: number }[] = [];
      for (let frame = 0; frame < 18; frame++) {
        await new Promise<void>((resolve) =>
          // Inspect the painted frame after all animation-frame callbacks,
          // regardless of whether this observer or the crop update ran first.
          requestAnimationFrame(() => setTimeout(resolve, 0)),
        );
        const stage = document.querySelector("#stage")!.getBoundingClientRect();
        for (const face of document.querySelectorAll<HTMLElement>(
          ".input-face",
        )) {
          const rect = face.getBoundingClientRect();
          const scale = rect.width / face.offsetWidth;
          const style = getComputedStyle(face);
          const [width, height] = style.backgroundSize
            .split(",")[0]
            .split(" ")
            .map(parseFloat);
          const error = Math.max(
            Math.abs(
              rect.left +
                parseFloat(style.backgroundPositionX) * scale -
                stage.left,
            ),
            Math.abs(
              rect.top +
                parseFloat(style.backgroundPositionY) * scale -
                stage.top,
            ),
            Math.abs(width * scale - stage.width),
            Math.abs(height * scale - stage.height),
          );
          if (frame > 1)
            samples.push({
              error,
              moving: [face, face.closest(".card-slot")].some((el) =>
                el?.getAnimations().some((a) => a.playState === "running"),
              ),
              x: rect.left,
            });
        }
      }
      return samples;
    });
  await page.keyboard.press("ArrowRight");
  let samples = await sampleMotion();
  expect(samples.some((s) => s.moving)).toBe(true);
  expect(Math.max(...samples.map((s) => s.error))).toBeLessThan(1);
  await contextMenu(page, "input:DP:1");
  await item(page, "item-move").click();
  await page.keyboard.press("ArrowRight");
  samples = await sampleMotion();
  expect(samples.some((s) => s.moving)).toBe(true);
  expect(new Set(samples.map((s) => s.x)).size).toBeGreaterThan(3);
  expect(Math.max(...samples.map((s) => s.error))).toBeLessThan(1);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(50);
  await page.keyboard.press("ArrowLeft");
  samples = await sampleMotion();
  expect(samples.some((s) => s.moving)).toBe(true);
  expect(Math.max(...samples.map((s) => s.error))).toBeLessThan(1);
  // Settled frost must not keep scheduling style updates in the background.
  const mutations = await page.evaluate(async () => {
    let count = 0;
    const observer = new MutationObserver(
      (records) => (count += records.length),
    );
    document
      .querySelectorAll(".input-face")
      .forEach((face) =>
        observer.observe(face, {
          attributes: true,
          attributeFilter: ["style"],
        }),
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
    observer.disconnect();
    return count;
  });
  expect(mutations).toBe(0);
});

test("move arrows work with the mouse and reduced motion does not animate reordered slots", async ({
  page,
}) => {
  await contextMenu(page, "input:DP:1");
  await item(page, "item-move").click();
  await page.getByRole("button", { name: "Move right", exact: true }).click();
  await expect(
    page.locator('[data-shelf="inputs"] .card').nth(1),
  ).toHaveAttribute("data-id", "DP:1");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await contextMenu(page, "input:DP:1");
  await item(page, "item-move").click();
  await page.keyboard.press("ArrowRight");
  expect(
    await page
      .locator(".moving-slot")
      .evaluate((el) => el.getAnimations().length),
  ).toBe(0);
});

test("section popup separates its footer and hides unavailable directions for two sections", async ({
  page,
}) => {
  await category(page, "layout");
  await item(page, "setting:order").click();
  await expect(item(page, "section-up:inputs")).toHaveCount(0);
  await expect(item(page, "section-down:inputs")).toBeEnabled();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "section-down:inputs")).toBeFocused();
  await item(page, "section-down:inputs").click();
  await expect(item(page, "section-down:inputs")).toHaveCount(0);
  await expect(item(page, "section-up:inputs")).toBeEnabled();
  const bottom = await page.locator(".section-row").last().boundingBox(),
    save = await item(page, "sections-save").boundingBox();
  expect(save!.y - (bottom!.y + bottom!.height)).toBeGreaterThanOrEqual(30);
  await expect(page.locator(".reorder-mark")).toHaveCount(0);
});

test("every section has visible vector arrows before selection and label editing reuses the spaced footer", async ({
  page,
}) => {
  await category(page, "layout");
  await item(page, "setting:order").click();
  await expect(page.locator(".section-tools button")).toHaveCount(2);
  for (const button of await page.locator(".section-tools button").all())
    await expect(button).toBeVisible();
  await expect(page.locator(".section-tools svg")).toHaveCount(2);
  await expect(item(page, "section-up:inputs")).toHaveCount(0);
  await expect(item(page, "section-down:apps")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "section-down:inputs")).toBeFocused();
  await page.keyboard.press("Escape");
  await item(page, "settings-close").click();
  await contextMenu(page, "input:DP:1");
  await item(page, "item-label").click();
  const input = await page.locator("#input-label").boundingBox(),
    footer = await page.locator(".label-panel .popup-footer").boundingBox();
  expect(footer!.y - (input!.y + input!.height)).toBeGreaterThanOrEqual(30);
});

test("rapid menu navigation updates selection on every keydown while surfaces animate", async ({
  page,
}) => {
  await category(page, "layout");
  await page.waitForTimeout(200);
  const selections = await page.evaluate(() => {
    const keys = [
      "ArrowRight",
      "ArrowDown",
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "ArrowLeft",
      "ArrowRight",
    ];
    return keys.map((key) => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, repeat: true }),
      );
      const el = document.activeElement as HTMLElement;
      const surface = getComputedStyle(el, "::before");
      return {
        id: el.dataset.focus,
        background: surface.backgroundColor,
        transition: surface.transitionProperty,
      };
    });
  });
  expect(selections.map((selection) => selection.id)).toEqual([
    "setting:order",
    "setting:samsung-home",
    "setting:clock",
    "setting:samsung-home",
    "category:layout",
    "setting:samsung-home",
    "category:layout",
    "setting:samsung-home",
  ]);
  for (const selection of selections) {
    expect(selection.background).toBe("rgb(34, 49, 73)");
    expect(selection.transition).toBe("transform");
  }
  await expect(item(page, "setting:samsung-home")).toHaveClass(/focused/);
  expect(
    await item(page, "setting:samsung-home").evaluate((el) =>
      el
        .getAnimations({ subtree: true })
        .some(
          (animation) =>
            (animation as CSSTransition).transitionProperty === "transform",
        ),
    ),
  ).toBe(true);
});

test("focus surfaces animate in both directions while neighboring controls stay still", async ({
  page,
}) => {
  await page.waitForTimeout(200);
  const input = item(page, "input:DP:1");
  const face = input.locator(".card-face");
  const neighbor = item(page, "input:HDMI:1");
  expect(
    await face.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        overflow: style.overflow,
        transition: style.transitionProperty,
        willChange: style.willChange,
      };
    }),
  ).toEqual({
    overflow: "visible",
    transition: "transform",
    willChange: "transform",
  });
  const before = await neighbor.boundingBox();
  await page.keyboard.press("ArrowDown");
  await expect(input).not.toHaveClass(/focused/);
  expect(
    await face.evaluate((el) =>
      el
        .getAnimations()
        .some((a) => (a as CSSTransition).transitionProperty === "transform"),
    ),
  ).toBe(true);
  expect(await neighbor.boundingBox()).toEqual(before);
  expect(await neighbor.evaluate((el) => el.getAnimations().length)).toBe(0);
  // Let the outgoing transition advance before testing its reversal.
  await page.waitForTimeout(50);
  await page.keyboard.press("ArrowUp");
  expect(
    await face.evaluate((el) =>
      el
        .getAnimations()
        .some((a) => (a as CSSTransition).transitionProperty === "transform"),
    ),
  ).toBe(true);
  await category(page, "layout");
  await page.waitForTimeout(200);
  const row = page.locator('[data-group="settings-list"]').nth(1);
  const rowBefore = await row.boundingBox();
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "setting:order")).toBeFocused();
  expect(await row.boundingBox()).toEqual(rowBefore);
  await page.waitForTimeout(180);
  await page.keyboard.press("ArrowLeft");
  expect(await row.boundingBox()).toEqual(rowBefore);
  expect(await row.evaluate((el) => el.getAnimations().length)).toBe(0);
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`unfocused neighbors retain geometry across grids and dialogs (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    const stationary = async (
      target: string,
      neighbor: string,
      exit: string,
    ) => {
      await item(page, exit).focus();
      await page.waitForTimeout(180);
      const other = item(page, neighbor);
      const bounds = await other.boundingBox();
      await item(page, target).focus();
      await page.waitForTimeout(80);
      expect(await other.boundingBox()).toEqual(bounds);
      await page.waitForTimeout(100);
      expect(await other.boundingBox()).toEqual(bounds);
      await item(page, exit).focus();
      await page.waitForTimeout(180);
      expect(await other.boundingBox()).toEqual(bounds);
    };
    await stationary("input:HDMI:1", "input:HDMI:2", "settings");
    await item(page, "all-apps").click();
    await stationary("app:preview.prime", "app:preview.apple", "all-back");
    await page.keyboard.press("Escape");
    await category(page, "wallpaper");
    await stationary(
      "wallpaper:w002",
      "wallpaper:w003",
      "setting:wallpaper-mode",
    );
    await item(page, "setting:wallpaper-mode").click();
    await item(page, "setting:rotation").click();
    await stationary("option:1", "option:2", "option:0");
  });
}

test("clock and rotation intervals stop while hidden and resume without accumulation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const ids = new Set<number>();
    const start = window.setInterval.bind(window),
      stop = window.clearInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number) => {
      const id = start(handler, timeout);
      ids.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      ids.delete(id!);
      stop(id);
    }) as typeof window.clearInterval;
    Object.defineProperty(window, "prismActiveTimers", { get: () => ids.size });
  });
  await page.reload();
  const active = () =>
    page.evaluate(
      () =>
        (window as unknown as { prismActiveTimers: number }).prismActiveTimers,
    );
  const baseline = await active(); // Includes the Vite development client heartbeat.
  expect(baseline).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await active()).toBe(baseline - 2);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await active()).toBe(baseline);
  }
});

test("rapid wallpaper changes ignore outdated loads/errors and retain the last good image on failure", async ({
  page,
}) => {
  const held: import("@playwright/test").Route[] = [];
  await page.route("**/wallpapers/w001.jpg", (route) => {
    held.push(route);
  });
  await category(page, "wallpaper");
  await item(page, "wallpaper:w001").click();
  await item(page, "preview-apply").click();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await item(page, "wallpaper:w003").click();
  await item(page, "preview-apply").click();
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w003\.jpg/,
  );
  await Promise.all(held.map((route) => route.abort().catch(() => {})));
  await page.waitForTimeout(100);
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w003\.jpg/,
  );
  await expect(page.locator("#toast")).not.toContainText("could not be loaded");
  await page.route("**/wallpapers/w004.jpg", (route) => route.abort());
  await item(page, "wallpaper:w004").click();
  await item(page, "preview-apply").click();
  await expect(page.locator("#toast")).toContainText("could not be loaded");
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w003\.jpg/,
  );
});

test("wallpaper rotation keeps its deadline across app suspension, Settings and reload", async ({
  page,
}) => {
  await page.clock.install();
  await category(page, "wallpaper");
  await item(page, "setting:wallpaper-mode").click();
  await item(page, "setting:rotation").click();
  await item(page, "option:0").click();
  await item(page, "settings-close").click();
  await page.clock.fastForward(120000);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(120000);
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w002/,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await category(page, "layout");
  await page.clock.fastForward(70000);
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w002/,
  );
  await item(page, "settings-close").click();
  await page.clock.fastForward(10000);
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w003/,
  );
  await page.clock.fastForward(240000);
  await page.reload();
  await expect(item(page, "input:DP:1")).toBeFocused();
  await page.clock.fastForward(70000);
  await expect(page.locator("#wallpaper")).toHaveCSS(
    "background-image",
    /w004/,
  );
});

test("Samsung Home shortcut launches native Home and its visibility persists", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.tizen = {
      application: {
        getAppsInfo: (ok) => ok([]),
        launch: (id, ok) => {
          document.body.dataset.launchedApp = id;
          ok();
        },
      },
      systeminfo: {
        getPropertyValue: (_key, ok) =>
          ok({ connected: [{ type: "DP", number: 1 }], disconnected: [] }),
      },
      tvwindow: { setSource: (_source, ok) => ok() },
    };
  });
  await page.reload();
  const shortcut = item(page, "native-home");
  await expect(shortcut).toBeVisible();
  await shortcut.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveAttribute(
    "data-launched-app",
    "com.samsung.tv.csfs",
  );
  await category(page, "system");
  await expect(page.getByText("Samsung Settings", { exact: true })).toHaveCount(
    0,
  );
  await item(page, "category:layout").focus();
  await expect(item(page, "setting:samsung-home")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await item(page, "setting:samsung-home").click();
  await item(page, "settings-close").click();
  await expect(shortcut).toHaveCount(0);
  await page.reload();
  await expect(shortcut).toHaveCount(0);
  await category(page, "layout");
  await expect(item(page, "setting:samsung-home")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await item(page, "setting:samsung-home").click();
  await item(page, "settings-close").click();
  await expect(shortcut).toBeVisible();
});
