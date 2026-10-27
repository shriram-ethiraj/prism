import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import sharp from "sharp";
const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root));
const { version } = JSON.parse(await read("package.json"));
const sources = JSON.parse(await read("assets/wallpapers/sources.json"));
const digest = (data) => createHash("sha256").update(data).digest("hex");
for (const resolution of ["1080p", "2160p"]) {
  test(`${resolution} package contains complete offline assets, dimensions, attribution and unchanged masters`, async () => {
    const entries = unzipSync(
      await read(`packages/Prism-${version}-${resolution}-unsigned.wgt`),
    );
    const manifest = JSON.parse(
      Buffer.from(entries["wallpapers/manifest.json"]).toString(),
    );
    assert.equal(manifest.schema, 1);
    assert.equal(manifest.resolution, resolution);
    assert.equal(manifest.images.length, 50);
    const width = resolution === "1080p" ? 1920 : 3840,
      height = (width * 9) / 16;
    assert.equal(manifest.width, width);
    assert.equal(manifest.height, height);
    assert.equal(new Set(manifest.images.map((x) => x.id)).size, 50);
    const catalog = JSON.parse(
      Buffer.from(entries["wallpapers/SOURCES.json"]).toString(),
    );
    assert.deepEqual(catalog, sources);
    for (const source of sources) {
      assert.match(source.file, /^images\/w\d{3}\.jpg$/);
      for (const field of [
        "preview", "upstream_preview", "preview_sha256", "preview_modification",
        "black_area_in_preview", "dark_area_in_preview", "note", "crop_note",
        "review_status", "starter", "tags", "genre", "id",
        "dimensions_verified_from_file",
      ]) {
        assert.ok(
          !Object.hasOwn(source.original_source, field),
          `Research field ${field} leaked into packaged attribution: ${source.id}`,
        );
      }
      assert.ok(source.credit && source.license && source.source);
      assert.ok(source.original_source.title);
      assert.ok(!/owner-approved|research preview/i.test(source.crop));
      assert.equal(
        digest(await read(`assets/wallpapers/${source.file}`)),
        source.master_sha256,
      );
      const image = manifest.images.find((x) => x.id === source.id);
      assert.ok(image);
      assert.equal(image.masterSha256, source.master_sha256);
      assert.equal(digest(entries[image.file]), image.sha256);
      for (const [path, w, h] of [
        [image.file, width, height],
        [`wallpapers/${source.id}-thumb.jpg`, 640, 360],
        [`wallpapers/${source.id}-frost.jpg`, 960, 540],
      ]) {
        assert.ok(entries[path], `missing ${path}`);
        const decoded = await sharp(Buffer.from(entries[path]))
          .raw()
          .toBuffer({ resolveWithObject: true });
        assert.equal(decoded.info.width, w);
        assert.equal(decoded.info.height, h);
      }
    }
    const files = Object.keys(entries);
    assert.equal(
      files.filter((f) => /^wallpapers\/[a-z0-9-]+\.jpg$/.test(f)).length,
      150,
    );
    assert.ok(files.some((f) => f.startsWith("wallpapers/licenses/")));
    assert.ok(
      files.every(
        (f) =>
          !/experimentation|research\/|branding\/|\.map$|-tizen\.png|hotstar\.png|(?:1080p|2160p)\//.test(
            f,
          ),
      ),
    );
    const html = Buffer.from(entries["index.html"]).toString();
    assert.ok(html.includes("width=1920, height=1080"));
    for (const ref of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g))
      assert.ok(entries[ref[1]], `missing ${ref[1]}`);
    assert.ok(
      Buffer.from(entries["config.xml"]).toString().includes("Prizen0001.Home"),
    );
    const appManifest = Buffer.from(entries["config.xml"]).toString();
    assert.match(
      appManifest,
      /<tizen:src name="index.html" reload="disable"\s*\/>/,
    );
    assert.ok(
      appManifest.includes('name="http://tizen.org/appcontrol/operation/main"'),
    );
  });
}
