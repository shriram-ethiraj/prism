import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WALLPAPER,
  defaults,
  loadPreferences,
  moveId,
  normalize,
  ordered,
} from "../src/store.ts";
import { normalizeHomeOrder, sectionDirections } from "../src/home-sections.ts";
import { launchable } from "../src/catalog.ts";
test("corrupt stored data recovers to usable defaults", () => {
  assert.deepEqual(loadPreferences({ getItem: () => "{bad" }), defaults());
  assert.deepEqual(normalize(null), defaults());
  assert.equal(defaults().wallpaper, DEFAULT_WALLPAPER);
  assert.equal(DEFAULT_WALLPAPER, "w002");
});
test("wallpaper renumbering preserves an existing saved selection", () => {
  assert.equal(
    normalize({ version: 1, wallpaper: "glass-chip" }).wallpaper,
    "w001",
  );
  assert.equal(normalize({ version: 1, wallpaper: "w003" }).wallpaper, "w002");
  assert.equal(normalize({ version: 2, wallpaper: "w003" }).wallpaper, "w003");
});

test("reconciliation retains saved order and includes newly discovered apps", () => {
  assert.deepEqual(
    ordered(
      [{ id: "new" }, { id: "b" }, { id: "a" }],
      ["removed", "a", "b"],
      (a) => a.id,
    ).map((a) => a.id),
    ["a", "b", "new"],
  );
});
test("a move is immutable and clamps at either edge", () => {
  const original = ["a", "b", "c"];
  assert.deepEqual(moveId(original, "a", -1), original);
  assert.deepEqual(moveId(original, "b", 1), ["a", "c", "b"]);
  assert.deepEqual(original, ["a", "b", "c"]);
});
test("invalid saved preferences cannot inject arbitrary appearance or malformed item data", () => {
  const prefs = normalize({
    material: "bogus",
    dim: 9000,
    apps: { app: { visible: false, label: "Desktop", symbol: "console" } },
    appOrder: ["app", "app", null],
  });
  assert.equal("material" in prefs, false);
  assert.equal(prefs.dim, 0.14);
  assert.equal(prefs.apps.app.visible, false);
  assert.deepEqual(prefs.appOrder, ["app"]);
});
test("retail system screens are filtered without a hand-maintained store-app catalog", () => {
  assert.equal(
    launchable({
      id: "com.samsung.tv.coba.smartthings",
      name: "CompSmartThings",
      show: true,
      iconPath: "/opt/icon.png",
    }),
    false,
  );
  assert.equal(
    launchable({
      id: "NewApp0001.Home",
      name: "A newly installed app",
      show: true,
      iconPath: "/opt/apps/icon.png",
    }),
    true,
  );
  assert.equal(
    launchable({
      id: "org.tizen.primevideo",
      name: "Prime Video",
      show: true,
      iconPath: "/opt/apps/prime.png",
    }),
    true,
  );
  assert.equal(
    launchable({
      id: "NewApp0001.Service",
      name: "Background service",
      show: false,
      iconPath: "/opt/apps/icon.png",
    }),
    false,
  );
});

test("legacy preferences retain labels/order while retired filters normalize", () => {
  const p = normalize({
    showDisconnected: false,
    collection: "Mountains",
    apps: { a: { visible: false, label: "Mine" } },
    appOrder: ["a"],
    inputs: { "DP:1": { visible: true, label: "Work", symbol: "laptop" } },
  });
  assert.equal(p.showDisconnected, true);
  assert.equal(p.collection, "All");
  assert.equal(p.apps.a.label, "Mine");
  assert.equal(p.inputs["DP:1"].symbol, "laptop");
  assert.deepEqual(p.appOrder, ["a"]);
});

test("retired appearance and size preferences cannot change the single presentation", () => {
  const p = normalize({
    density: "compact",
    material: "matte",
    accent: "neutral",
    reducedMotion: true,
    highContrast: true,
    apps: { a: { visible: false, label: "Mine" } },
    appOrder: ["a"],
  });
  for (const key of [
    "density",
    "material",
    "accent",
    "reducedMotion",
    "highContrast",
  ])
    assert.equal(key in p, false);
  assert.equal(p.apps.a.label, "Mine");
  assert.deepEqual(p.appOrder, ["a"]);
});

test("section arrays migrate old order, reject unknown duplicates and append available sections", () => {
  assert.deepEqual(normalizeHomeOrder(undefined, "apps-first"), [
    "apps",
    "inputs",
  ]);
  assert.deepEqual(normalizeHomeOrder(["apps", "apps", "unknown"]), [
    "apps",
    "inputs",
  ]);
  assert.deepEqual(normalizeHomeOrder([]), ["inputs", "apps"]);
  assert.deepEqual(normalize({ sectionOrder: "apps-first" }).homeOrder, [
    "apps",
    "inputs",
  ]);
});

test("two sections show only valid arrows; larger lists preserve disabled boundaries", () => {
  assert.deepEqual(sectionDirections(0, 1), []);
  assert.deepEqual(sectionDirections(0, 2), [
    { direction: "down", disabled: false },
  ]);
  assert.deepEqual(sectionDirections(1, 2), [
    { direction: "up", disabled: false },
  ]);
  assert.deepEqual(sectionDirections(0, 3), [
    { direction: "up", disabled: true },
    { direction: "down", disabled: false },
  ]);
  assert.deepEqual(sectionDirections(1, 3), [
    { direction: "up", disabled: false },
    { direction: "down", disabled: false },
  ]);
  assert.deepEqual(sectionDirections(2, 3), [
    { direction: "up", disabled: false },
    { direction: "down", disabled: true },
  ]);
});

test("new Home and rotation preferences migrate without losing customizations", () => {
  const old = {
    appOrder: ["favorite"],
    inputs: { "DP:1": { visible: true, label: "My PC" } },
  };
  const migrated = normalize(old);
  assert.equal(migrated.samsungHome, true);
  assert.equal(migrated.wallpaperChangedAt, 0);
  assert.deepEqual(migrated.appOrder, ["favorite"]);
  assert.equal(migrated.inputs["DP:1"].label, "My PC");
  assert.equal(normalize({ samsungHome: false }).samsungHome, false);
  assert.equal(
    normalize({ wallpaperChangedAt: 1793000000000 }).wallpaperChangedAt,
    1793000000000,
  );
  for (const value of [-1, "123", Infinity, 1.5])
    assert.equal(
      normalize({ wallpaperChangedAt: value }).wallpaperChangedAt,
      0,
    );
});
