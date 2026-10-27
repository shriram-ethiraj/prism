import { chooseDirectional, type Direction } from "./spatial";
export type { Direction } from "./spatial";
interface Target {
  element: HTMLElement;
  group: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Layout search is confined to a scope. Screen-to-screen routes belong to the UI. */
export class FocusController {
  private current: HTMLElement | null = null;
  private targets: Target[] | null = null;
  private frames: number[] = [];
  private observer: ResizeObserver;
  constructor(private root: HTMLElement) {
    root.addEventListener("focusin", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-focus]",
      );
      if (target && !target.closest("[inert]")) this.select(target);
    });
    this.observer = new ResizeObserver(() => this.invalidate());
    this.observer.observe(root);
  }
  invalidate(): void {
    this.targets = null;
  }
  private list(): Target[] {
    if (this.targets) return this.targets;
    this.targets = Array.from(
      this.root.querySelectorAll<HTMLElement>("[data-focus]"),
    )
      .filter(
        (el) =>
          el.offsetWidth > 0 &&
          !el.hasAttribute("disabled") &&
          !el.closest("[inert]"),
      )
      .map((element) => {
        let x = 0,
          y = 0,
          ancestor: HTMLElement | null = element;
        while (ancestor && ancestor !== this.root) {
          x += ancestor.offsetLeft;
          y += ancestor.offsetTop;
          ancestor = ancestor.offsetParent as HTMLElement | null;
        }
        return {
          element,
          group: element.dataset.group || "",
          x,
          y,
          width: element.offsetWidth,
          height: element.offsetHeight,
        };
      });
    return this.targets;
  }
  private snap(): void {
    this.frames.forEach(cancelAnimationFrame);
    this.root.classList.add("focus-snap");
    this.frames = [
      requestAnimationFrame(() =>
        this.frames.push(
          requestAnimationFrame(() => this.root.classList.remove("focus-snap")),
        ),
      ),
    ];
  }
  private select(target: HTMLElement): void {
    if (target === this.current) return;
    this.current?.classList.remove("focused");
    this.current = target;
    target.classList.add("focused");
    const scroll = target.closest<HTMLElement>(
      ".shelf-window,.detail-scroll,.all-grid,.dialog-scroll",
    );
    if (!scroll) return;
    const a = target.getBoundingClientRect(),
      b = scroll.getBoundingClientRect(),
      scale = this.root.getBoundingClientRect().width / 1920;
    const gutter = target.classList.contains("moving") ? 64 : 24;
    if (a.left < b.left + gutter)
      scroll.scrollLeft -= (b.left + gutter - a.left) / scale;
    else if (a.right > b.right - gutter)
      scroll.scrollLeft += (a.right - b.right + gutter) / scale;
    if (a.top < b.top + 12) scroll.scrollTop -= (b.top + 12 - a.top) / scale;
    else if (a.bottom > b.bottom - 12)
      scroll.scrollTop += (a.bottom - b.bottom + 12) / scale;
  }
  focus(id?: string, immediate = false): boolean {
    if (!id) return false;
    const list = this.list(),
      target = id ? list.find((t) => t.element.dataset.focus === id) : list[0];
    if (!target) return false;
    if (immediate) this.snap();
    target.element.focus({ preventScroll: true });
    return true;
  }
  ids(group?: string): string[] {
    return this.list()
      .filter((t) => !group || t.group === group)
      .map((t) => t.element.dataset.focus!);
  }
  nearest(group: string): string | undefined {
    const a = this.list().find((t) => t.element === this.current);
    const targets = this.list().filter((t) => t.group === group);
    if (!a) return targets[0]?.element.dataset.focus;
    // Use visible positions, including shelf scrolling and the display scale.
    const bounds = a.element.getBoundingClientRect();
    const center = bounds.left + bounds.width / 2;
    const distance = (target: Target): number => {
      const rect = target.element.getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - center);
    };
    targets.sort((b, c) => distance(b) - distance(c));
    return targets[0]?.element.dataset.focus;
  }
  moveWithin(direction: Direction): boolean {
    const list = this.list(),
      a = list.find((t) => t.element === this.current);
    if (!a) return false;
    const horizontal = direction === "left" || direction === "right";
    let best: Target | undefined,
      score = Infinity;
    for (const b of list) {
      if (b === a || b.group !== a.group) continue;
      const dx = b.x + b.width / 2 - a.x - a.width / 2,
        dy = b.y + b.height / 2 - a.y - a.height / 2;
      const primary = horizontal
        ? direction === "left"
          ? -dx
          : dx
        : direction === "up"
          ? -dy
          : dy;
      const cross = Math.abs(horizontal ? dy : dx);
      if (primary < 8) continue;
      if (horizontal && cross > Math.min(a.height, b.height) / 2) continue;
      if (!horizontal && Math.abs(dy) < Math.min(a.height, b.height) / 2)
        continue;
      const value = primary + cross * (horizontal ? 6 : 1.5);
      if (value < score) {
        score = value;
        best = b;
      }
    }
    return best ? this.focus(best.element.dataset.focus) : false;
  }
  nearestInDirection(direction: Direction): string | undefined {
    if (!this.current) return undefined;
    const origin = this.current.getBoundingClientRect(),
      root = this.root.getBoundingClientRect();
    const candidates = this.list()
      .filter((target) => target.element !== this.current)
      .map((target, order) => ({
        value: target.element.dataset.focus!,
        rect: target.element.getBoundingClientRect(),
        order,
      }))
      .filter(
        ({ rect }) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > root.left &&
          rect.left < root.right &&
          rect.bottom > root.top &&
          rect.top < root.bottom,
      );
    return chooseDirectional(origin, candidates, direction);
  }
  moveSpatial(direction: Direction): boolean {
    if (this.moveWithin(direction)) return true;
    const target = this.nearestInDirection(direction);
    return target ? this.focus(target) : false;
  }
  get id(): string | undefined {
    return this.current?.dataset.focus;
  }
  get group(): string {
    return this.current?.dataset.group || "";
  }
  destroy(): void {
    this.observer.disconnect();
    this.frames.forEach(cancelAnimationFrame);
    this.targets = null;
    this.current = null;
  }
}
