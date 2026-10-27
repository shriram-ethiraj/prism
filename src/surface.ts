/** Native sizing uses a reviewed logical surface, never overflow-inflated metrics. */
export interface Surface { width: number; height: number }
export function nativeSurface(value: unknown): Surface {
  if (value && typeof value === "object") {
    const { width, height } = value as Surface;
    if ((width === 1280 && height === 720) ||
        (width === 1920 && height === 1080) ||
        (width === 3840 && height === 2160)) return { width, height };
  }
  return { width: 1920, height: 1080 };
}
