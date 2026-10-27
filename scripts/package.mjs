import { withBuildLock } from "./build-lock.mjs";
import {
  copyFile,
  writeFile,
  mkdir,
  readFile,
  readdir,
} from "node:fs/promises";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import sharp from "sharp";
import { createHash } from "node:crypto";
await withBuildLock(async () => {
  const root = resolve(import.meta.dirname, "..");
  const { version } = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  );
  const htmlPath = resolve(root, "dist/index.html");
  const html = await readFile(htmlPath, "utf8");
  await writeFile(
    htmlPath,
    html.replace(
      "width=device-width, initial-scale=1.0",
      "width=1920, height=1080",
    ),
  );
  await copyFile(
    resolve(root, "tizen/config.xml"),
    resolve(root, "dist/config.xml"),
  );
  await copyFile(
    resolve(root, "public/icon.png"),
    resolve(root, "dist/icon.png"),
  );
  // Vite targets Chromium85, uses relative assets and emits no network dependencies.
  await mkdir(resolve(root, "packages"), { recursive: true });
  const sources = JSON.parse(
    await readFile(resolve(root, "assets/wallpapers/sources.json"), "utf8"),
  );
  const entries = {};
  async function walk(dir, prefix = "") {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(resolve(dir, entry.name), name + "/");
      else
        entries[name] = new Uint8Array(
          await readFile(resolve(dir, entry.name)),
        );
    }
  }
  await walk(resolve(root, "dist"));
  // Both packages use stable runtime paths; only full-size JPEGs and their
  // explicit resolution/hash manifest differ. No unused variant ships on-device.
  for (const resolution of ["1080p", "2160p"]) {
    const variant = resolve(root, ".local/wallpaper-variants", resolution);
    const manifestBytes = await readFile(resolve(variant, "manifest.json"));
    const manifest = JSON.parse(manifestBytes);
    if (
      manifest.schema !== 1 ||
      manifest.resolution !== resolution ||
      !manifest.images.length
    )
      throw new Error(`Invalid wallpaper manifest: ${resolution}`);
    const packaged = {
      ...entries,
      "wallpapers/manifest.json": new Uint8Array(manifestBytes),
    };
    for (const image of manifest.images) {
      const source = sources.find((item) => item.id === image.id);
      if (source) {
        const master = await readFile(
          resolve(root, "assets/wallpapers", source.file),
        );
        const hash = createHash("sha256").update(master).digest("hex");
        if (image.masterSha256 !== hash || source.master_sha256 !== hash)
          throw new Error(
            `Wallpaper source changed since asset preparation: ${image.id}. Rebuild assets.`,
          );
      }
      if (!/^wallpapers\/[a-z0-9-]+\.jpg$/.test(image.file))
        throw new Error("Invalid wallpaper path");
      const data = await readFile(
        resolve(variant, image.file.slice("wallpapers/".length)),
      );
      const decoded = await sharp(data).metadata();
      if (
        decoded.width !== image.width ||
        decoded.height !== image.height ||
        createHash("sha256").update(data).digest("hex") !== image.sha256
      )
        throw new Error(`Wallpaper dimensions/hash mismatch: ${image.id}`);
      if (!packaged[image.file])
        throw new Error(`Missing default wallpaper: ${image.id}`);
      for (const suffix of ["-thumb.jpg", "-frost.jpg"]) {
        if (!packaged[image.file.slice(0, -4) + suffix]?.length)
          throw new Error(
            `Missing shared wallpaper asset: ${image.id}${suffix}`,
          );
      }
      packaged[image.file] = new Uint8Array(data);
    }
    for (const required of [
      "index.html",
      "config.xml",
      "icon.png",
      "device-artwork.js",
      "device-profile.js",
    ])
      if (!packaged[required])
        throw new Error(`Missing packaged file: ${required}`);
    const archive = zipSync(packaged, { level: 6 });
    const filename = `Prism-${version}-${resolution}-unsigned.wgt`;
    await writeFile(resolve(root, "packages", filename), archive);
    console.log(
      `Packaged ${Object.keys(packaged).length} files into packages/${filename} (${(archive.length / 1048576).toFixed(2)} MiB)`,
    );
  }
});
