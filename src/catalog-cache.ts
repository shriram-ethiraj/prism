import type { AppInfo, Source } from "./types";
import { launchable } from "./catalog";

export const CATALOG_KEY = "prism.catalog.v1";
interface Catalog { apps: AppInfo[]; inputs: Source[] }
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const empty = (): Catalog => ({ apps: [], inputs: [] });

function normalize(value: unknown): Catalog {
  if (!value || typeof value !== "object") return empty();
  const data = value as { version?: unknown; apps?: unknown; inputs?: unknown };
  if (data.version !== 1 || !Array.isArray(data.apps) || !Array.isArray(data.inputs)) return empty();
  const apps: AppInfo[] = [], inputs: Source[] = [];
  const appIds = new Set<string>(), sourceIds = new Set<string>();
  for (const item of data.apps.slice(0, 512)) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" ||
        !/^[A-Za-z0-9_.-]{1,160}$/.test(item.id) || typeof item.name !== "string" ||
        !item.name || item.name.length > 160 || typeof item.iconPath !== "string" ||
        item.iconPath.length > 2048 || (item.iconPath !== "" && !/^(?:file:\/\/\/|\/|\.\/)/.test(item.iconPath))) continue;
    const app: AppInfo = { id: item.id, name: item.name, iconPath: item.iconPath, show: item.show !== false };
    if (launchable(app) && !appIds.has(app.id)) { apps.push(app); appIds.add(app.id); }
  }
  for (const item of data.inputs.slice(0, 64)) {
    if (!item || typeof item !== "object" || typeof item.type !== "string" ||
        !/^[A-Z_]{1,32}$/.test(item.type) || ["TV", "MEDIA", "UNKNOWN"].includes(item.type) ||
        !Number.isInteger(item.number) || item.number < 0 || item.number > 64) continue;
    const id = `${item.type}:${item.number}`;
    if (!sourceIds.has(id)) {
      // Cached identities are useful immediately; signal state must be read afresh.
      inputs.push({ type: item.type, number: item.number, connected: false, stale: true });
      sourceIds.add(id);
    }
  }
  return { apps, inputs };
}

export function loadCatalog(storage: Storage): Catalog {
  try {
    const raw = storage.getItem(CATALOG_KEY);
    return raw && raw.length <= 512000 ? normalize(JSON.parse(raw)) : empty();
  } catch { return empty(); }
}

export function saveCatalog(storage: Storage, catalog: Catalog): void {
  try {
    const safe = normalize({ version: 1, ...catalog });
    storage.setItem(CATALOG_KEY, JSON.stringify({ version: 1, apps: safe.apps,
      inputs: safe.inputs.map(({ type, number }) => ({ type, number })) }));
  } catch { /* Storage is optional; discovery still works without a cache. */ }
}
