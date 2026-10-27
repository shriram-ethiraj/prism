import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG_KEY, loadCatalog, saveCatalog } from "../src/catalog-cache.ts";

test("cached discovery stores only public presentation identities and never native descriptors or signal claims", () => {
  let raw = "";
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  saveCatalog(storage, {
    apps: [{ id: "example.Video", name: "Video", iconPath: "file:///opt/video/icon.png" }],
    inputs: [{ type: "DP", number: 1, connected: true, nativeSource: { type: "DP", number: 1 } }],
  });
  assert.equal(JSON.parse(raw).inputs[0].nativeSource, undefined);
  assert.equal(JSON.parse(raw).inputs[0].connected, undefined);
  const loaded = loadCatalog(storage);
  assert.equal(loaded.apps[0].id, "example.Video");
  assert.deepEqual(loaded.inputs, [{ type: "DP", number: 1, connected: false, stale: true }]);
  assert.equal(CATALOG_KEY, "prism.catalog.v1");
});

test("corrupt, oversized, denied or incompatible storage cannot prevent fresh discovery", () => {
  const empty = { apps: [], inputs: [] };
  for (const raw of ["broken", JSON.stringify({ version: 2, apps: [], inputs: [] }), "a".repeat(512001)])
    assert.deepEqual(loadCatalog({ getItem: () => raw, setItem: () => {} }), empty);
  const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  assert.deepEqual(loadCatalog(denied), empty);
  assert.doesNotThrow(() => saveCatalog(denied, empty));
});

test("cached data cannot introduce invalid IDs, arbitrary icon URLs, system services or duplicate inputs", () => {
  const raw = JSON.stringify({ version: 1, apps: [
    { id: "example.Good", name: "Good", iconPath: "/opt/good/icon.png" },
    { id: "example.Good", name: "Duplicate", iconPath: "/opt/good/icon.png" },
    { id: "invalid id", name: "Bad", iconPath: "/icon.png" },
    { id: "example.Remote", name: "Remote", iconPath: "https://invalid.example/image.png" },
    { id: "com.samsung.service", name: "Service", iconPath: "/icon.png" },
  ], inputs: [{ type: "HDMI", number: 1 }, { type: "HDMI", number: 1 }, { type: "HDMI", number: -1 }, { type: "UNKNOWN", number: 1 }] });
  const loaded = loadCatalog({ getItem: () => raw, setItem: () => {} });
  assert.equal(loaded.apps.length, 1);
  assert.equal(loaded.inputs.length, 1);
});
