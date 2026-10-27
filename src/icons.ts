export type IconName =
  | "home"
  | "monitor"
  | "grid"
  | "settings"
  | "arrow"
  | "check"
  | "wallpaper"
  | "layout"
  | "sliders"
  | "apps"
  | "input"
  | "info"
  | "laptop"
  | "console"
  | "close"
  | "refresh"
  | "sun"
  | "back";
const paths: Record<IconName, string> = {
  home: '<path d="m3 14 13-11 13 11M6 12v17h20V12M12 29V18h8v11"/>',
  monitor:
    '<rect x="3" y="4" width="26" height="18" rx="3"/><path d="M11 28h10M16 22v6"/>',
  laptop:
    '<rect x="6" y="4" width="20" height="18" rx="2"/><path d="M3 27h26l-3-5H6l-3 5Z"/>',
  console:
    '<path d="M11 10h10c5 0 8 5 8 11s-4 7-7 2l-2-2h-8l-2 2c-3 5-7 4-7-2s3-11 8-11Z"/><path d="M9 14v6m-3-3h6m10-2h.01m3 4h.01"/>',
  grid: '<rect x="4" y="4" width="9" height="9" rx="2"/><rect x="19" y="4" width="9" height="9" rx="2"/><rect x="4" y="19" width="9" height="9" rx="2"/><rect x="19" y="19" width="9" height="9" rx="2"/>',
  apps: '<rect x="4" y="4" width="9" height="9" rx="2"/><rect x="19" y="4" width="9" height="9" rx="2"/><rect x="4" y="19" width="9" height="9" rx="2"/><rect x="19" y="19" width="9" height="9" rx="2"/>',
  settings:
    '<path d="m13 3-1 4-4 2-4-1-2 5 3 3v4l-3 3 3 5 4-1 3 2 1 3h6l1-3 3-2 4 1 3-5-3-3v-4l3-3-2-5-4 1-4-2-1-4Z" transform="translate(0 -1) scale(.96)"/><circle cx="16" cy="16" r="5"/>',
  arrow: '<path d="m12 7 9 9-9 9"/>',
  check: '<path d="m7 17 6 6L26 9"/>',
  wallpaper:
    '<rect x="3" y="4" width="26" height="24" rx="4"/><circle cx="11" cy="12" r="3"/><path d="m4 25 8-8 5 5 6-9 6 9"/>',
  layout:
    '<rect x="3" y="4" width="26" height="24" rx="3"/><path d="M3 12h26M13 12v16"/>',
  sliders:
    '<path d="M5 8h22M5 16h22M5 24h22"/><circle cx="12" cy="8" r="3" fill="currentColor"/><circle cx="21" cy="16" r="3" fill="currentColor"/><circle cx="10" cy="24" r="3" fill="currentColor"/>',
  input:
    '<path d="M7 4h18v9l-4 5v6H11v-6l-4-5V4Zm4 0v5m5-5v5m5-5v5M13 24v5m6-5v5"/>',
  info: '<circle cx="16" cy="16" r="13"/><path d="M16 14v10m0-16h.01"/>',
  close: '<path d="m8 8 16 16M24 8 8 24"/>',
  refresh: '<path d="M27 13A11 11 0 1 0 26 23M27 5v8h-8"/>',
  sun: '<circle cx="16" cy="16" r="6"/><path d="M16 1v4m0 22v4M1 16h4m22 0h4M5 5l3 3m16 16 3 3M5 27l3-3M24 8l3-3"/>',
  back: '<path d="m19 7-9 9 9 9"/>',
};
export function icon(name: IconName, cls = ""): string {
  return `<svg class="symbol ${cls}" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
