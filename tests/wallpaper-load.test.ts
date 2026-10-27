import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWallpaper } from "../src/wallpaper-load.ts";
import type { Wallpaper } from "../src/types.ts";

test("wallpaper loading cancels stale callbacks and reports one current outcome", () => {
  const images: FakeImage[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = "";
    constructor() {
      images.push(this);
    }
    removeAttribute() {
      this.src = "";
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "Image");
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: FakeImage,
  });
  try {
    const wallpaper = { image: "image.jpg", blur: "frost.jpg" } as Wallpaper;
    let ready = 0,
      errors = 0;
    const cancel = loadWallpaper(
      wallpaper,
      () => ready++,
      () => errors++,
    );
    const staleSuccess = images[0].onload!,
      staleError = images[1].onerror!;
    cancel();
    staleSuccess();
    staleError();
    assert.equal(ready, 0);
    assert.equal(errors, 0);
    assert.equal(images[0].src, "");
    loadWallpaper(
      wallpaper,
      () => ready++,
      () => errors++,
    );
    images[2].onload!();
    assert.equal(ready, 0);
    images[3].onload!();
    assert.equal(ready, 1);
    loadWallpaper(
      wallpaper,
      () => ready++,
      () => errors++,
    );
    const secondFailure = images[5].onerror!;
    images[4].onerror!();
    secondFailure();
    assert.equal(ready, 1);
    assert.equal(errors, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "Image", original);
    else Reflect.deleteProperty(globalThis, "Image");
  }
});
