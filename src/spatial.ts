export type Direction = "left" | "right" | "up" | "down";

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Candidate<T> {
  value: T;
  rect: Rect;
  order: number;
}

const HORIZONTAL_CROSS_WEIGHT = 3;
const VERTICAL_CROSS_WEIGHT = 1;
const ALIGNMENT_WEIGHT = 2;

interface Measurement {
  primary: number;
  cross: number;
  overlap: number;
  crossSize: number;
}

function measure(
  origin: Rect,
  candidate: Rect,
  direction: Direction,
): Measurement | null {
  const horizontal = direction === "left" || direction === "right";
  const primary =
    direction === "left"
      ? origin.left - candidate.right
      : direction === "right"
        ? candidate.left - origin.right
        : direction === "up"
          ? origin.top - candidate.bottom
          : candidate.top - origin.bottom;
  if (primary < 0) return null;
  const cross = horizontal
    ? Math.max(0, candidate.top - origin.bottom, origin.top - candidate.bottom)
    : Math.max(0, candidate.left - origin.right, origin.left - candidate.right);
  const overlap = horizontal
    ? Math.max(
        0,
        Math.min(origin.bottom, candidate.bottom) -
          Math.max(origin.top, candidate.top),
      )
    : Math.max(
        0,
        Math.min(origin.right, candidate.right) -
          Math.max(origin.left, candidate.left),
      );
  return {
    primary,
    cross,
    overlap,
    crossSize: Math.max(1, horizontal ? origin.height : origin.width),
  };
}

/** Choose the geometrically nearest candidate that lies beyond the request edge. */
export function chooseDirectional<T>(
  origin: Rect,
  candidates: Candidate<T>[],
  direction: Direction,
): T | undefined {
  const horizontal = direction === "left" || direction === "right";
  const crossWeight = horizontal
    ? HORIZONTAL_CROSS_WEIGHT
    : VERTICAL_CROSS_WEIGHT;
  const originX = (origin.left + origin.right) / 2,
    originY = (origin.top + origin.bottom) / 2;
  let best:
    { value: T; score: number; center: number; order: number } | undefined;
  for (const candidate of candidates) {
    const measurement = measure(origin, candidate.rect, direction);
    if (!measurement) continue;
    const alignment = Math.min(1, measurement.overlap / measurement.crossSize);
    const score =
      measurement.primary +
      measurement.cross * crossWeight -
      alignment * ALIGNMENT_WEIGHT;
    const center = Math.hypot(
      (candidate.rect.left + candidate.rect.right) / 2 - originX,
      (candidate.rect.top + candidate.rect.bottom) / 2 - originY,
    );
    if (
      !best ||
      score < best.score ||
      (score === best.score && center < best.center) ||
      (score === best.score &&
        center === best.center &&
        candidate.order < best.order)
    )
      best = { value: candidate.value, score, center, order: candidate.order };
  }
  return best?.value;
}
