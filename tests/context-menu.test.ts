import { test } from "node:test";
import assert from "node:assert/strict";
import { contextPosition } from "../src/context-menu.ts";
test("menu placement flips at the right edge and clamps within the TV stage", () => {
  const stage = { left: 0, top: 0, width: 1920, height: 1080 };
  const right = contextPosition(
    { left: 1690, top: 860, width: 250, height: 250 },
    stage,
    { width: 240, height: 130 },
  );
  assert.ok(right.left < 1690);
  assert.ok(right.top + 130 <= 1056);
  const left = contextPosition(
    { left: 10, top: 10, width: 250, height: 250 },
    stage,
    { width: 240, height: 130 },
  );
  assert.equal(left.left, 278);
  assert.ok(left.top >= 24);
});
test("scaled preview anchors convert to the same native TV coordinates", () => {
  const native = contextPosition(
    { left: 400, top: 300, width: 250, height: 250 },
    { left: 0, top: 0, width: 1920, height: 1080 },
    { width: 240, height: 130 },
  );
  const scaled = contextPosition(
    { left: 200, top: 150, width: 125, height: 125 },
    { left: 0, top: 0, width: 960, height: 540 },
    { width: 240, height: 130 },
  );
  assert.deepEqual(scaled, native);
});
