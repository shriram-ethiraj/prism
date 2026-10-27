import type { Preferences } from "./types";
import { normalizeHomeOrder } from "./home-sections";
// Preserve the pre-rename key so existing Home customizations survive upgrades.
export const STORAGE_KEY = "prizen.preferences.v1";
export const DEFAULT_WALLPAPER = "w002";
// Wallpaper files were renumbered sequentially in October 2026. Version 1
// preferences still hold the old selection IDs, so translate them once.
const LEGACY_WALLPAPER_IDS: Record<string, string> = {
  "glass-chip": "w001",
  w003: "w002",
  w016: "w003",
  w025: "w004",
  w028: "w005",
  w041: "w006",
  w042: "w007",
  w085: "w008",
  w088: "w009",
  w097: "w010",
  w116: "w011",
  w127: "w012",
  w153: "w013",
  w165: "w014",
  w169: "w015",
  w170: "w016",
  w172: "w017",
  w176: "w018",
  w182: "w019",
  w199: "w020",
  w214: "w021",
  w220: "w022",
  w221: "w023",
  w224: "w024",
  w229: "w025",
  w230: "w026",
  w232: "w027",
  w233: "w028",
  w234: "w029",
  w235: "w030",
  w236: "w031",
  w237: "w032",
  w238: "w033",
  w240: "w034",
  w241: "w035",
  w242: "w036",
  w243: "w037",
  w245: "w038",
  w246: "w039",
  w248: "w040",
  w253: "w041",
  w256: "w042",
  w257: "w043",
  w259: "w044",
  w262: "w045",
  w263: "w046",
  w264: "w047",
  w266: "w048",
  w269: "w049",
  w270: "w050",
};
export function defaults(): Preferences {
  return {
    version: 2,
    homeOrder: normalizeHomeOrder(undefined),
    samsungHome: true,
    clock: true,
    date: true,
    clockFormat: "system",
    apps: {},
    appOrder: [],
    inputs: {},
    inputOrder: [],
    showDisconnected: true,
    wallpaper: DEFAULT_WALLPAPER,
    wallpaperMode: "single",
    collection: "All",
    rotationMinutes: 15,
    wallpaperChangedAt: 0,
    dim: 0.14,
  };
}
function itemMap(value: unknown): Preferences["apps"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Preferences["apps"] = Object.create(
    null,
  ) as Preferences["apps"];
  Object.entries(value)
    .slice(0, 500)
    .forEach(([id, data]) => {
      if (!data || typeof data !== "object") return;
      const p = data as Record<string, unknown>;
      result[id] = {
        visible: p.visible !== false,
        ...(typeof p.label === "string" ? { label: p.label.slice(0, 80) } : {}),
        ...(typeof p.symbol === "string" &&
        ["auto", "desktop", "laptop", "console"].includes(p.symbol)
          ? { symbol: p.symbol }
          : {}),
      };
    });
  return result;
}
export function normalize(value: unknown): Preferences {
  const p = defaults();
  if (!value || typeof value !== "object" || Array.isArray(value)) return p;
  const v = value as Record<string, unknown>;
  p.homeOrder = normalizeHomeOrder(v.homeOrder, v.sectionOrder);
  for (const k of ["clock", "date", "showDisconnected", "samsungHome"] as const)
    if (typeof v[k] === "boolean") p[k] = v[k];
  if (v.clockFormat === "12" || v.clockFormat === "24")
    p.clockFormat = v.clockFormat;
  if (typeof v.wallpaper === "string")
    p.wallpaper = (
      v.version === 2
        ? v.wallpaper
        : (LEGACY_WALLPAPER_IDS[v.wallpaper] ?? v.wallpaper)
    ).slice(0, 180);
  if (
    typeof v.wallpaperChangedAt === "number" &&
    Number.isSafeInteger(v.wallpaperChangedAt) &&
    v.wallpaperChangedAt > 0
  )
    p.wallpaperChangedAt = v.wallpaperChangedAt;
  if (v.wallpaperMode === "rotate") p.wallpaperMode = "rotate";
  if (typeof v.collection === "string")
    p.collection = v.collection.slice(0, 80);
  if ([5, 15, 30, 60].includes(Number(v.rotationMinutes)))
    p.rotationMinutes = Number(v.rotationMinutes);
  if ([0, 0.14, 0.28, 0.42].includes(Number(v.dim))) p.dim = Number(v.dim);
  // Retired controls are normalized so enabling an input is sufficient to show it.
  p.showDisconnected = true;
  p.collection = "All";
  p.apps = itemMap(v.apps);
  p.inputs = itemMap(v.inputs);
  for (const k of ["appOrder", "inputOrder"] as const)
    if (Array.isArray(v[k]))
      p[k] = Array.from(
        new Set(
          (v[k] as unknown[]).filter(
            (id): id is string => typeof id === "string",
          ),
        ),
      ).slice(0, 500);
  return p;
}
export function loadPreferences(
  storage: Pick<Storage, "getItem"> = localStorage,
): Preferences {
  try {
    return normalize(JSON.parse(storage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return defaults();
  }
}
export function ordered<T>(
  items: T[],
  ids: string[],
  key: (item: T) => string,
): T[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return items
    .slice()
    .sort((a, b) => (rank.get(key(a)) ?? 10000) - (rank.get(key(b)) ?? 10000));
}
export function moveId(ids: string[], id: string, delta: number): string[] {
  const out = ids.slice();
  const index = out.indexOf(id);
  if (index < 0) return out;
  const next = Math.max(0, Math.min(out.length - 1, index + delta));
  out.splice(index, 1);
  out.splice(next, 0, id);
  return out;
}
