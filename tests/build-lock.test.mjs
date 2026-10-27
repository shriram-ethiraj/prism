import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { withBuildLock } from "../scripts/build-lock.mjs";

test("build lock permits nested steps, rejects another process and releases on failure", async () => {
  const module = new URL("../scripts/build-lock.mjs", import.meta.url).href;
  await assert.rejects(
    withBuildLock(async () => {
      let nested = false;
      await withBuildLock(async () => {
        nested = true;
      });
      assert.ok(nested);
      const other = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {withBuildLock} from ${JSON.stringify(module)}; await withBuildLock(async()=>{});`,
        ],
        { encoding: "utf8" },
      );
      assert.notEqual(other.status, 0);
      assert.match(other.stderr, /Another Prism build\/asset process/);
      throw new Error("simulated build failure");
    }),
    /simulated build failure/,
  );
  let released = false;
  await withBuildLock(async () => {
    released = true;
  });
  assert.ok(released);
});
