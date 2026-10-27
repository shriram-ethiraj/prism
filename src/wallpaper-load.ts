import type { Wallpaper } from "./types";

/** Two bounded image loads. Cancelling detaches stale successes and errors. */
export function loadWallpaper(
  wallpaper: Wallpaper,
  ready: () => void,
  failed: () => void,
): () => void {
  const images = [new Image(), new Image()];
  let remaining = images.length;
  let active = true;
  const detach = (): void => {
    for (const image of images) image.onload = image.onerror = null;
  };
  for (const [index, image] of images.entries()) {
    image.onload = () => {
      if (!active || --remaining > 0) return;
      active = false;
      detach();
      ready();
    };
    image.onerror = () => {
      if (!active) return;
      active = false;
      detach();
      failed();
    };
    image.src = index === 0 ? wallpaper.image : wallpaper.blur;
  }
  return () => {
    active = false;
    detach();
    for (const image of images) image.removeAttribute("src");
  };
}
