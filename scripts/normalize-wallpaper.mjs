// Used only when explicitly regenerating the approved offline masters.
import sharp from "sharp";
const [input, output, cropJSON] = process.argv.slice(2);
if (!input || !output) throw new Error("Provide a source image and output path");
const options = { limitInputPixels: 200000000 };
const metadata = await sharp(input, options).metadata();
if ((metadata.width || 0) < 3840 || (metadata.height || 0) < 2160)
  throw new Error("Source is below 4K dimensions");
const crop = cropJSON ? JSON.parse(cropJSON) : null;
if (crop && (
  ![crop.left, crop.top, crop.width, crop.height].every(Number.isInteger) ||
  crop.left < 0 || crop.top < 0 || crop.width < 3840 || crop.height < 2160 ||
  crop.left + crop.width > metadata.width || crop.top + crop.height > metadata.height
)) throw new Error("Crop is outside the source or below 4K dimensions");
const image = sharp(input, options).rotate();
if (crop) image.extract(crop);
await image
  .toColourspace("srgb")
  .resize(3840, 2160, {
    fit: "cover",
    position: "centre",
    withoutEnlargement: true,
  })
  .jpeg({ quality: 96, chromaSubsampling: "4:4:4", mozjpeg: true })
  .toFile(output);
console.log(JSON.stringify({ width: metadata.width, height: metadata.height }));
