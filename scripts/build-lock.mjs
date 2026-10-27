import { mkdir, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
const directory = resolve(import.meta.dirname, "../.local");
const path = resolve(directory, "build.lock");
let active = false;

/** Serialize source-asset, Vite and package writes across local build processes. */
export async function withBuildLock(action) {
  if (active) return action(); // Nested imports inside the build coordinator.
  await mkdir(directory, { recursive: true });
  let lock;
  try {
    lock = await open(path, "wx");
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "Another Prism build/asset process holds .local/build.lock. Wait for it to finish. After an interruption, confirm no build is running before removing the stale lock.",
      );
    throw error;
  }
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, started: new Date().toISOString() }),
    );
    active = true;
    return await action();
  } finally {
    active = false;
    await lock.close();
    await unlink(path);
  }
}
