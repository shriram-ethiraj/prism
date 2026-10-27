import type { AppInfo, Platform, Source, NativeSource } from "./types";
import { launchable } from "./catalog";
interface SourceInfo {
  connected: NativeSource[];
  disconnected: NativeSource[];
}
interface TizenApp {
  getAppsInfo(ok: (apps: AppInfo[]) => void, error: (e: Error) => void): void;
  launch(id: string, ok: () => void, error: (e: Error) => void): void;
}
interface NativeTizen {
  application: TizenApp;
  systeminfo: {
    getPropertyValue(
      key: string,
      ok: (value: SourceInfo) => void,
      error: (e: Error) => void,
    ): void;
  };
  tvwindow: {
    setSource(
      source: NativeSource,
      ok: () => void,
      error: (e: Error) => void,
      type: string,
    ): void;
  };
  tvinputdevice?: {
    registerKeyBatch(keys: string[]): void;
    getKey?(name: string): { name: string; code: number } | null;
    registerKey?(name: string): void;
  };
}
declare global {
  interface Window {
    tizen?: NativeTizen;
    PRISM_ARTWORK?: Record<string, string[]>;
    PRISM_SURFACE?: unknown;
    Prism?: Record<string, unknown>;
  }
}
function bounded<T>(
  fn: (ok: (value: T) => void, error: (e: Error) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("The monitor did not respond. Please try again.")),
      8000,
    );
    try {
      fn(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}
// Licensed preview marks and an original placeholder; never monitor captures.
// Native discovery and its identities/artwork remain independent of fixtures.
const fixtures: AppInfo[] = [
  {
    id: "preview.youtube",
    name: "YouTube",
    iconPath: "./preview-icons/youtube.svg",
  },
  {
    id: "preview.prime",
    name: "Prime Video",
    iconPath: "./preview-icons/prime.svg",
  },
  {
    id: "preview.apple",
    name: "Apple TV",
    iconPath: "./preview-icons/apple.svg",
  },
];
const native = !!window.tizen;
export const sourceId = (source: NativeSource): string =>
  `${source.type}:${source.number}`;
export const sourceName = (source: NativeSource): string =>
  `${source.type === "DP" ? "DisplayPort" : source.type} ${source.number}`;
export const platform: Platform = {
  native,
  async apps() {
    if (!window.tizen) return fixtures.slice();
    const list = await bounded<AppInfo[]>((ok, error) =>
      window.tizen!.application.getAppsInfo(ok, error),
    );
    return list.filter(launchable).sort((a, b) => a.name.localeCompare(b.name));
  },
  async sources() {
    if (!window.tizen)
      return [
        { type: "DP", number: 1, connected: true },
        { type: "HDMI", number: 1, connected: false },
        { type: "HDMI", number: 2, connected: false },
      ];
    const result = await bounded<SourceInfo>((ok, error) =>
      window.tizen!.systeminfo.getPropertyValue("VIDEOSOURCE", ok, error),
    );
    const sources = new Map<string, Source>();
    for (const [list, connected] of [
      [result.connected, true],
      [result.disconnected, false],
    ] as const)
      for (const item of list || [])
        if (!["TV", "MEDIA", "UNKNOWN"].includes(item.type))
          sources.set(sourceId(item), {
            type: item.type,
            number: item.number,
            connected,
            nativeSource: item,
          });
    return Array.from(sources.values()).sort((a, b) =>
      a.type === b.type
        ? a.number - b.number
        : a.type === "DP"
          ? -1
          : b.type === "DP"
            ? 1
            : a.type.localeCompare(b.type),
    );
  },
  async launch(id) {
    if (!window.tizen)
      throw new Error("Preview: app launching is available on your monitor.");
    await bounded<void>((ok, error) =>
      window.tizen!.application.launch(id, ok, error),
    );
  },
  async switchSource(source) {
    if (!window.tizen)
      throw new Error(`Preview: would switch to ${sourceName(source)}.`);
    // Use the original discovered descriptor and return video to Samsung's native viewer.
    const list = await this.sources();
    const current = list.find((s) => sourceId(s) === sourceId(source));
    if (!current)
      throw new Error("This input is no longer reported by the monitor.");
    await bounded<void>((ok, error) =>
      window.tizen!.tvwindow.setSource(
        current.nativeSource!,
        ok,
        error,
        "MAIN",
      ),
    );
    await this.launch("org.tizen.tv-viewer");
  },
  async samsungHome() {
    await this.launch("com.samsung.tv.csfs");
  },
};
export function artworkCandidates(app: AppInfo): string[] {
  const cached = window.PRISM_ARTWORK?.[app.id] || [];
  const path = app.iconPath || "";
  const first = path.startsWith("/") ? `file://${path}` : path;
  const candidates = [...cached, first];
  if (first.startsWith("file:///") && first.includes("/shared/res/")) {
    const directory = first.slice(0, first.lastIndexOf("/") + 1);
    candidates.push(
      ...[
        "icon.png",
        "icon.jpg",
        "appicon.png",
        "app_icon.png",
        `${app.id}.png`,
      ].map((name) => directory + name),
    );
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

try {
  window.tizen?.tvinputdevice?.registerKeyBatch([
    "MediaPlayPause",
    "ColorF0Red",
    "ColorF1Green",
    "ColorF2Yellow",
    "ColorF3Blue",
  ]);
} catch {
  /* Standard navigation remains available. */
}
export let homeKeyCode = 0;
try {
  const key = window.tizen?.tvinputdevice?.getKey?.("Home");
  if (key?.code) {
    window.tizen!.tvinputdevice!.registerKey?.("Home");
    homeKeyCode = key.code;
  }
} catch {
  /* Home remains a system key on models that do not expose it. */
}
