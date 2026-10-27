import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { build } from "vite";
import { withBuildLock } from "./build-lock.mjs";
const root = resolve(import.meta.dirname, "..");
await withBuildLock(async () => {
  await import("./prepare-assets.mjs");
  execFileSync(
    process.execPath,
    [resolve(root, "node_modules/typescript/bin/tsc"), "--noEmit"],
    { cwd: root, stdio: "inherit" },
  );
  await build({ root });
  await import("./package.mjs");
});
