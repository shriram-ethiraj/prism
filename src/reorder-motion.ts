/** Capture the visible positions, including an interrupted previous animation. */
export function captureOrder(container: HTMLElement): Map<string, DOMRect> {
  return new Map(
    Array.from(
      container.querySelectorAll<HTMLElement>(".card-slot,.section-row"),
    ).map((el) => [el.dataset.key!, el.getBoundingClientRect()]),
  );
}
/** FLIP moves slots; the focused card lift remains independent. */
export function animateOrder(
  container: HTMLElement,
  before: Map<string, DOMRect>,
  scale: number,
): Animation[] {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || scale <= 0)
    return [];
  const animations: Animation[] = [];
  for (const slot of container.querySelectorAll<HTMLElement>(
    ".card-slot,.section-row",
  )) {
    const old = before.get(slot.dataset.key!);
    if (!old) continue;
    const next = slot.getBoundingClientRect(),
      dx = (old.left - next.left) / scale,
      dy = (old.top - next.top) / scale;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    animations.push(
      slot.animate(
        [
          { transform: `translate3d(${dx}px,${dy}px,0)` },
          { transform: "translate3d(0,0,0)" },
        ],
        { duration: 220, easing: "cubic-bezier(.2,.75,.2,1)" },
      ),
    );
  }
  return animations;
}
