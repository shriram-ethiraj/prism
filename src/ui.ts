export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function button(
  id: string,
  action: string,
  body: string,
  cls = "",
  group = "content",
  attrs = "",
): string {
  return `<button type="button" class="${cls}" data-focus="${escapeHtml(id)}" data-action="${escapeHtml(action)}" data-group="${escapeHtml(group)}" tabindex="-1" ${attrs}>${body}</button>`;
}
export interface FooterAction {
  id: string;
  action: string;
  label: string;
}
/** Shared footer structure keeps spacing identical in every popup. */
export function popupFooter(actions: FooterAction[], group: string): string {
  return `<div class="popup-footer dialog-actions">${actions.map((a) => button(a.id, a.action, escapeHtml(a.label), "action-button", group)).join("")}</div>`;
}
