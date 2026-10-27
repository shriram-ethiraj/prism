import { withBuildLock } from "./build-lock.mjs";
import sharp from "sharp";
import { mkdir, readdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import { resolve, basename, extname, relative } from "node:path";
import { createHash } from "node:crypto";
await withBuildLock(async () => {
  const root = resolve(import.meta.dirname, "..");
  // Keep the packaged icon reproducible from the approved full-resolution master.
  await sharp(resolve(root, "assets/branding/prism-icon-source.png"))
    .resize(256, 256, { fit: "contain" })
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, "public/icon.png"));
  const source = resolve(root, "assets/wallpapers");
  const out = resolve(root, "public/wallpapers");
  const variants = resolve(root, ".local/wallpaper-variants");
  const encoding = JSON.parse(
    await readFile(resolve(source, "encoding.json"), "utf8"),
  );
  const manifests = Object.fromEntries(
    ["1080p", "2160p"].map((resolution) => [
      resolution,
      {
        schema: 1,
        resolution,
        width: resolution === "1080p" ? 1920 : 3840,
        height: resolution === "1080p" ? 1080 : 2160,
        images: [],
      },
    ]),
  );
  for (const resolution of Object.keys(manifests)) {
    await rm(resolve(variants, resolution), { recursive: true, force: true });
    await mkdir(resolve(variants, resolution), { recursive: true });
  }
  await mkdir(out, { recursive: true });
  for (const name of await readdir(out))
    await rm(resolve(out, name), { recursive: true, force: true });
  await mkdir(resolve(root, "src/generated"), { recursive: true });
  await mkdir(resolve(source, "custom"), { recursive: true });
  let curated = [];
  try {
    curated = JSON.parse(
      await readFile(resolve(source, "sources.json"), "utf8"),
    );
  } catch {
    /* A custom-only collection is supported. */
  }
  const custom = (await readdir(resolve(source, "custom")))
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort()
    .map((file) => ({
      id: `custom-${basename(file, extname(file))
        .toLowerCase()
        .replace(
          /[^a-z0-9]+/g,
          "-",
        )}-${createHash("sha256").update(file).digest("hex").slice(0, 6)}`,
      title: basename(file, extname(file)).replace(/[-_]/g, " "),
      category: "Custom",
      file: `custom/${file}`,
      credit: "Personal collection",
      source: "",
    }));
  const catalog = [];
  for (const item of [...curated, ...custom]) {
    try {
      const input = resolve(source, item.file);
      if (!relative(source, input) || relative(source, input).startsWith(".."))
        throw new Error("invalid source path");
      const metadata = await sharp(input, {
        limitInputPixels: 140000000,
      }).metadata();
      if (
        item.category !== "Custom" &&
        ((metadata.width || 0) < 3840 || (metadata.height || 0) < 2160)
      )
        throw new Error("Bundled source is below 4K dimensions");
      const master = item.prepared ? await readFile(input) : null;
      if (
        master &&
        (metadata.width !== 3840 ||
          metadata.height !== 2160 ||
          metadata.format !== "jpeg" ||
          createHash("sha256").update(master).digest("hex") !==
            item.master_sha256)
      )
        throw new Error(`Approved wallpaper master changed: ${item.id}`);
      const pipeline = sharp(input, { limitInputPixels: 140000000 })
        .rotate()
        .resize(3840, 2160, {
          fit: item.fit || "cover",
          position: item.position || "centre",
          withoutEnlargement: true,
          background: "#000000",
        });
      // Leave checked-in approved masters untouched. Each runtime derivative is
      // encoded directly from the same reviewed crop, never from another variant.
      const image =
        master ||
        (await pipeline
          .jpeg({
            quality: 93,
            chromaSubsampling: "4:4:4",
            mozjpeg: true,
          })
          .toBuffer());
      const extension = "jpg";
      const original = sharp(image);
      const color = await original
        .clone()
        .resize(32, 18)
        .removeAlpha()
        .raw()
        .toBuffer();
      const colors = [];
      for (let i = 0; i < color.length; i += 3) {
        const rgb = [color[i], color[i + 1], color[i + 2]];
        const bright = Math.max(...rgb);
        const low = Math.min(...rgb);
        if (bright > 45 && bright < 235 && bright - low > 20) colors.push(rgb);
      }
      const values = colors.length ? colors : [[110, 144, 168]];
      const accent = [0, 1, 2].map((c) =>
        Math.round(values.reduce((sum, v) => sum + v[c], 0) / values.length),
      );
      const quality = encoding.overrides[item.id] ?? encoding.quality;
      if (!Number.isInteger(quality) || quality < 90 || quality > 100)
        throw new Error(`Invalid runtime JPEG quality: ${item.id}`);
      for (const [resolution, manifest] of Object.entries(manifests)) {
        const data = await original
          .clone()
          .resize(manifest.width, manifest.height, {
            fit: "cover",
            withoutEnlargement: true,
          })
          .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:4:4" })
          .toBuffer();
        const dimensions = await sharp(data).metadata();
        const filename = `${item.id}.jpg`;
        await writeFile(resolve(variants, resolution, filename), data);
        if (resolution === "1080p")
          await writeFile(resolve(out, filename), data);
        manifest.images.push({
          id: item.id,
          file: `wallpapers/${filename}`,
          width: dimensions.width,
          height: dimensions.height,
          quality,
          masterSha256: createHash("sha256").update(image).digest("hex"),
          sha256: createHash("sha256").update(data).digest("hex"),
        });
      }
      await original
        .clone()
        .resize(960, 540)
        .blur(16)
        .jpeg({ quality: 85 })
        .toFile(resolve(out, `${item.id}-frost.jpg`));
      await original
        .clone()
        .resize(640, 360)
        .jpeg({ quality: 90 })
        .toFile(resolve(out, `${item.id}-thumb.jpg`));
      catalog.push({
        id: item.id,
        title: item.title,
        category: item.category,
        image: `./wallpapers/${item.id}.${extension}`,
        blur: `./wallpapers/${item.id}-frost.jpg`,
        thumb: `./wallpapers/${item.id}-thumb.jpg`,
        accent,
        credit: item.credit,
        source: item.source,
        license: item.license,
        crop: item.crop
          ? `${item.crop}; runtime JPEG compression and resolution-specific resizing`
          : undefined,
        originalTitle: item.original_source?.title,
        copyrightNotices: item.copyright_notices,
      });
    } catch (error) {
      if (item.category !== "Custom") throw error;
      console.error(`Wallpaper skipped: ${item.file}: ${error.message}`);
    }
  }
  for (const [resolution, manifest] of Object.entries(manifests)) {
    await writeFile(
      resolve(variants, resolution, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
  }
  await writeFile(
    resolve(out, "manifest.json"),
    JSON.stringify(manifests["1080p"], null, 2) + "\n",
  );
  if (!catalog.length)
    throw new Error(
      "No valid wallpapers. Add an image to assets/wallpapers/custom.",
    );
  await writeFile(
    resolve(root, "src/generated/wallpapers.ts"),
    `// Generated by npm run assets.\nimport type { Wallpaper } from '../types';\nexport const wallpapers: Wallpaper[] = ${JSON.stringify(catalog, null, 2)};\n`,
  );
  if (curated.length) {
    await cp(resolve(source, "licenses"), resolve(out, "licenses"), {
      recursive: true,
    });
    await writeFile(
      resolve(out, "SOURCES.json"),
      JSON.stringify(curated, null, 2) + "\n",
    );
    await writeFile(
      resolve(out, "CREDITS.md"),
      [
        "# Prism wallpaper artwork",
        "",
        "Each image retains the artwork license below, independently of Prism's MIT code license.",
        "Original sources and hashes: SOURCES.json. Additional notices: licenses/.",
        "",
        ...curated.flatMap((item) => [
          `## ${item.title} (${item.selection_id})`,
          "",
          `Credit: ${item.credit}`,
          `License: ${item.license}`,
          `Original title: ${item.original_source?.title || item.title}`,
          ...(item.copyright_notices || []).map(
            (notice) => `Copyright notice: ${notice}`,
          ),
          `Source: ${item.source}`,
          `Changes: ${item.crop}; runtime JPEG compression and resolution-specific resizing`,
          "",
        ]),
      ].join("\n"),
    );
  }
  console.log(
    `Prepared ${catalog.length} wallpapers and 1080p/4K variants and shared frost/thumbnail assets.`,
  );
});
