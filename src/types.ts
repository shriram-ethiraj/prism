import type { HomeSection } from "./home-sections";
export interface AppInfo {
  id: string;
  name: string;
  iconPath: string;
  version?: string;
  show?: boolean;
}
export interface NativeSource {
  readonly type: string;
  readonly number: number;
}
export interface Source {
  type: string;
  number: number;
  connected: boolean;
  stale?: boolean;
  editName?: string;
  nativeSource?: NativeSource;
}
export interface ItemPreference {
  visible: boolean;
  label?: string;
  symbol?: string;
}
export interface Preferences {
  version: 2;
  homeOrder: HomeSection[];
  samsungHome: boolean;
  clock: boolean;
  date: boolean;
  clockFormat: "system" | "12" | "24";
  apps: Record<string, ItemPreference>;
  appOrder: string[];
  inputs: Record<string, ItemPreference>;
  inputOrder: string[];
  showDisconnected: boolean;
  wallpaper: string;
  wallpaperMode: "single" | "rotate";
  collection: string;
  rotationMinutes: number;
  wallpaperChangedAt: number;
  dim: number;
}
export interface Wallpaper {
  id: string;
  title: string;
  category: string;
  image: string;
  blur: string;
  thumb: string;
  accent: [number, number, number];
  credit: string;
  source: string;
  license?: string;
  crop?: string;
  originalTitle?: string;
  copyrightNotices?: string[];
}
export type Page = "home" | "all-apps" | "settings";
export type Category = "layout" | "apps" | "inputs" | "wallpaper" | "system";
export interface Platform {
  native: boolean;
  apps(): Promise<AppInfo[]>;
  sources(): Promise<Source[]>;
  launch(id: string): Promise<void>;
  switchSource(source: Source): Promise<void>;
  samsungHome(): Promise<void>;
}
