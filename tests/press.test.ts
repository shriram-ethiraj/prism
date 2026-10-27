import { test } from "node:test";
import assert from "node:assert/strict";
import { RemotePress, remoteKey } from "../src/press.ts";
test("release distinguishes a tap from a completed hold", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const actions: string[] = [];
  const p = new RemotePress();
  p.begin(
    "a",
    () => actions.push("tap"),
    () => actions.push("hold"),
  );
  t.mock.timers.tick(599);
  assert.equal(actions.length, 0);
  p.release();
  assert.deepEqual(actions, ["tap"]);
  p.begin(
    "a",
    () => actions.push("tap"),
    () => actions.push("hold"),
  );
  t.mock.timers.tick(600);
  p.release();
  assert.deepEqual(actions, ["tap", "hold"]);
});
test("repeats do not restart holds; cancellation prevents activation", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const actions: string[] = [];
  const p = new RemotePress();
  p.begin(
    "a",
    () => actions.push("tap"),
    () => actions.push("hold"),
  );
  t.mock.timers.tick(400);
  p.begin("a", () => actions.push("duplicate"));
  t.mock.timers.tick(200);
  assert.deepEqual(actions, ["hold"]);
  p.release();
  p.begin(
    "b",
    () => actions.push("tap"),
    () => actions.push("hold"),
  );
  p.cancel();
  t.mock.timers.tick(900);
  p.release();
  assert.deepEqual(actions, ["hold"]);
});
test("Samsung numeric keys work when DOM key names are unavailable", () => {
  assert.equal(remoteKey({ key: "Unidentified", keyCode: 37 }), "ArrowLeft");
  assert.equal(remoteKey({ key: "Unidentified", keyCode: 10009 }), "Escape");
  assert.equal(remoteKey({ key: "Enter", keyCode: 13 }), "Enter");
});
