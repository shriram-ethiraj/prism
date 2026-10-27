export interface Rectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** Convert the rendered anchor to the fixed TV stage, then keep the popup on screen. */
export function contextPosition(
  anchor: Rectangle,
  stage: Rectangle,
  menu: { width: number; height: number },
): { left: number; top: number } {
  const scale = stage.width / 1920;
  const x = (anchor.left - stage.left) / scale,
    y = (anchor.top - stage.top) / scale;
  const width = anchor.width / scale,
    height = anchor.height / scale;
  let left = x + width + 18;
  if (left + menu.width > 1896) left = x - menu.width - 18;
  return {
    left: Math.max(24, Math.min(1896 - menu.width, left)),
    top: Math.max(24, Math.min(1056 - menu.height, y + height * 0.25)),
  };
}
