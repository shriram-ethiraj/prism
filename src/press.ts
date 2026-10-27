/** A remote tap activates on release; a completed hold can never activate too. */
export class RemotePress {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: { id: string; short: () => void; held: boolean } | null =
    null;
  constructor(private delay = 600) {}
  begin(id: string, short: () => void, long?: () => void): void {
    if (this.pending) return;
    this.pending = { id, short, held: false };
    if (long)
      this.timer = setTimeout(() => {
        if (!this.pending || this.pending.id !== id) return;
        this.pending.held = true;
        long();
      }, this.delay);
  }
  release(): void {
    const pending = this.pending;
    this.cancel();
    if (pending && !pending.held) pending.short();
  }
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
  }
  get id(): string | undefined {
    return this.pending?.id;
  }
}
export function remoteKey(
  event: Pick<KeyboardEvent, "key" | "keyCode">,
): string {
  const codes: Record<number, string> = {
    13: "Enter",
    37: "ArrowLeft",
    38: "ArrowUp",
    39: "ArrowRight",
    40: "ArrowDown",
    10009: "Escape",
  };
  return codes[event.keyCode] || event.key;
}
