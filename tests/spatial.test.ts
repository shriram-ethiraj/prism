import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseDirectional,
  type Direction,
  type Rect,
} from "../src/spatial.ts";

interface Item {
  id: string;
  rect: Rect;
}

const rect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): Rect => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
});

function home(): Item[] {
  return [
    { id: "native-home", rect: rect(1306, 72, 1555, 136) },
    { id: "all-apps", rect: rect(1573, 72, 1742, 136) },
    { id: "settings", rect: rect(1760, 72, 1824, 136) },
    { id: "input:DP:1", rect: rect(96, 316, 320, 540) },
    { id: "input:HDMI:1", rect: rect(384, 316, 608, 540) },
    { id: "input:HDMI:2", rect: rect(672, 316, 896, 540) },
    { id: "app:youtube", rect: rect(96, 666, 320, 890) },
    { id: "app:prime", rect: rect(384, 666, 608, 890) },
    { id: "app:apple", rect: rect(672, 666, 896, 890) },
    { id: "app:netflix", rect: rect(960, 666, 1184, 890) },
  ];
}

function choose(
  items: Item[],
  from: string,
  direction: Direction,
): string | undefined {
  const origin = items.find((item) => item.id === from);
  assert.ok(origin);
  return chooseDirectional(
    origin.rect,
    items.map((item, order) => ({ value: item.id, rect: item.rect, order })),
    direction,
  );
}

test("Left from Samsung Home prefers the nearest top-shelf card", () => {
  assert.equal(choose(home(), "native-home", "left"), "input:HDMI:2");
});

test("Left from the rightmost header control moves between header controls first", () => {
  assert.equal(choose(home(), "all-apps", "left"), "native-home");
});

test("Hidden Samsung Home makes All apps the leftmost header control", () => {
  const items = home().filter((item) => item.id !== "native-home");
  assert.equal(choose(items, "all-apps", "left"), "input:HDMI:2");
});

test("A longer app shelf does not steal Left from the top Inputs shelf", () => {
  const items = home().filter((item) => item.id !== "native-home");
  items.push({ id: "app:extra", rect: rect(1248, 666, 1472, 890) });
  assert.equal(choose(items, "all-apps", "left"), "input:HDMI:2");
});

test("The chosen card follows the actual order instead of a fixed identity", () => {
  const items = home().map((item) =>
    item.id === "input:DP:1"
      ? { ...item, rect: rect(960, 316, 1184, 540) }
      : item.id === "input:HDMI:2"
        ? { ...item, rect: rect(96, 316, 320, 540) }
        : item,
  );
  assert.equal(choose(items, "native-home", "left"), "input:DP:1");
});

test("Reordered sections choose the shelf that is actually on top", () => {
  const items = home().map((item) => {
    const top = item.rect.top === 316,
      bottom = item.rect.top === 666;
    if (top)
      return { ...item, rect: rect(item.rect.left, 666, item.rect.right, 890) };
    if (bottom)
      return { ...item, rect: rect(item.rect.left, 316, item.rect.right, 540) };
    return item;
  });
  assert.equal(choose(items, "native-home", "left"), "app:netflix");
});

test("Vertical moves use the nearest row and keep horizontal alignment", () => {
  assert.equal(choose(home(), "input:DP:1", "up"), "native-home");
  assert.equal(choose(home(), "native-home", "down"), "input:HDMI:2");
  assert.equal(choose(home(), "input:HDMI:2", "down"), "app:apple");
});

test("Only candidates beyond the requested edge are eligible", () => {
  assert.equal(choose(home(), "native-home", "right"), "all-apps");
  assert.equal(choose(home(), "input:DP:1", "left"), undefined);
});
