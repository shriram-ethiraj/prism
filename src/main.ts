import "./style.css";
import { loadWallpaper } from "./wallpaper-load";
import { escapeHtml as e, button, popupFooter } from "./ui";
import { wallpapers } from "./generated/wallpapers";
import { icon, type IconName } from "./icons";
import { FocusController, type Direction } from "./focus";
import { RemotePress, remoteKey } from "./press";
import { contextPosition } from "./context-menu";
import { captureOrder, animateOrder } from "./reorder-motion";
import {
  homeSections,
  sectionDirections,
  type HomeSection,
} from "./home-sections";
import {
  platform,
  artworkCandidates,
  homeKeyCode,
  sourceId,
  sourceName,
} from "./platform";
import { nativeSurface } from "./surface";
import { loadCatalog, saveCatalog } from "./catalog-cache";
import {
  defaults,
  DEFAULT_WALLPAPER,
  loadPreferences,
  moveId,
  ordered,
  STORAGE_KEY,
} from "./store";
import type {
  AppInfo,
  Category,
  ItemPreference,
  Page,
  Preferences,
  Source,
  Wallpaper,
} from "./types";

const root = document.querySelector<HTMLDivElement>("#app")!;
const surface = nativeSurface(window.PRISM_SURFACE);
if (platform.native)
  document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content =
    `width=${surface.width}, height=${surface.height}`;
root.innerHTML =
  '<main id="stage" aria-label="Prism"><div id="wallpaper" class="wallpaper"></div><div id="wallpaper-shade"></div><div id="scene"></div><div id="dialog-host"></div><div id="toast" role="status" aria-live="polite"></div></main>';
const stage = document.querySelector<HTMLElement>("#stage")!,
  scene = document.querySelector<HTMLElement>("#scene")!,
  dialogHost = document.querySelector<HTMLElement>("#dialog-host")!;
const focus = new FocusController(stage),
  press = new RemotePress();
let prefs = loadPreferences();
if (!wallpapers.some((w) => w.id === prefs.wallpaper))
  prefs.wallpaper =
    wallpapers.find((w) => w.id === DEFAULT_WALLPAPER)?.id || wallpapers[0].id;
if (!prefs.wallpaperChangedAt || prefs.wallpaperChangedAt > Date.now())
  prefs.wallpaperChangedAt = Date.now();
const catalogStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};
const cachedCatalog = platform.native
  ? loadCatalog(catalogStorage)
  : { apps: [], inputs: [] };
let apps: AppInfo[] = cachedCatalog.apps,
  inputs: Source[] = cachedCatalog.inputs,
  page: Page = "home",
  category: Category = "layout";
let homeFocus: string | undefined;
const settingsFocus = new Map<Category, string>();
let moving: { kind: "apps" | "inputs"; id: string; order: string[] } | null =
  null;
let temporaryWallpaper: string | null = null,
  wallRequest = 0,
  toastTimer = 0,
  pending = false,
  bootError = "",
  initialDiscovery = true;
let refreshing: Promise<void> | null = null,
  suppressClickUntil = 0;
const failedIcons = new Set<string>(),
  resolvedIcons = new Map<string, string>();
const TOAST_MS = 3500;
type Option = { label: string; value: string };
type ToastTone = "info" | "progress" | "success" | "error";
type Dialog =
  | {
      kind: "choice";
      title: string;
      options: Option[];
      value: string;
      select: (value: string) => void;
      returnTo?: string;
    }
  | { kind: "item"; itemKind: "apps" | "inputs"; id: string; returnTo?: string }
  | { kind: "wallpaper"; id: string; returnTo?: string }
  | { kind: "credits"; returnTo?: string }
  | { kind: "confirm"; returnTo?: string }
  | { kind: "label"; id: string; value: string; returnTo?: string }
  | {
      kind: "sections";
      order: HomeSection[];
      returnTo?: string;
    };
let dialog: Dialog | null = null;
const categories: { id: Category; label: string; symbol: IconName }[] = [
  { id: "layout", label: "Home layout", symbol: "layout" },
  { id: "apps", label: "Apps", symbol: "apps" },
  { id: "inputs", label: "Inputs", symbol: "input" },
  { id: "wallpaper", label: "Wallpaper", symbol: "wallpaper" },
  { id: "system", label: "System", symbol: "settings" },
];
function appLabel(app: AppInfo): string {
  return prefs.apps[app.id]?.label || app.name;
}
function inputLabel(source: Source): string {
  return (
    prefs.inputs[sourceId(source)]?.label ||
    source.editName ||
    sourceName(source)
  );
}
function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] || "")
    .join("")
    .toUpperCase();
}
function appImage(app: AppInfo, cls = ""): string {
  const src =
    resolvedIcons.get(app.id) ||
    artworkCandidates(app).find((path) => !failedIcons.has(path)) ||
    "";
  return `<span class="app-art ${cls}"><span class="initials">${e(initials(appLabel(app)))}</span>${src && !failedIcons.has(src) ? `<img src="${e(src)}" alt="" data-app-id="${e(app.id)}" data-app-image="${e(src)}" draggable="false"/>` : ""}</span>`;
}
function inputSymbol(source: Source): IconName {
  const choice = prefs.inputs[sourceId(source)]?.symbol;
  return choice === "console"
    ? "console"
    : choice === "laptop"
      ? "laptop"
      : choice === "desktop" || source.type === "DP"
        ? "monitor"
        : "input";
}
function appList(): AppInfo[] {
  return ordered(apps, prefs.appOrder, (a) => a.id);
}
function inputList(): Source[] {
  return ordered(inputs, prefs.inputOrder, sourceId);
}
function card(
  kind: "apps" | "inputs",
  id: string,
  label: string,
  face: string,
  group: string = kind,
): string {
  const editing = moving?.kind === kind && moving.id === id;
  const key = `${kind === "apps" ? "app" : "input"}:${id}`;
  const tile = button(
    key,
    kind === "apps" ? "launch" : "input",
    `<span class="card-face ${kind === "inputs" ? "input-face frost" : "app-face"}" data-focus-face>${face}</span>`,
    `card ${editing ? "moving" : ""}`,
    group,
    `data-id="${e(id)}" data-kind="${kind}" aria-label="${e(label)}" aria-haspopup="menu"`,
  );
  const siblings = !editing
    ? []
    : kind === "apps"
      ? listedApps()
          .filter((a) => prefs.apps[a.id]?.visible !== false)
          .map((a) => a.id)
      : listedInputs()
          .filter((s) => prefs.inputs[sourceId(s)]?.visible !== false)
          .map(sourceId);
  const index = siblings.indexOf(id);
  return `<div class="card-slot ${editing ? "moving-slot" : ""}" data-key="${e(key)}">${tile}${editing ? `<div class="move-handles">${button("move-prev", "move-prev", icon("back"), "move-handle previous", "move-controls", `aria-label="Move left" ${index === 0 ? "disabled" : ""}`)}${button("move-next", "move-next", icon("arrow"), "move-handle next", "move-controls", `aria-label="Move right" ${index === siblings.length - 1 ? "disabled" : ""}`)}</div>` : ""}</div>`;
}
function appCard(app: AppInfo, group = "apps"): string {
  return card("apps", app.id, appLabel(app), appImage(app), group);
}
function inputCard(source: Source): string {
  const label = inputLabel(source),
    port = sourceName(source);
  return card(
    "inputs",
    sourceId(source),
    label,
    `<span class="input-device">${icon(inputSymbol(source), "device-symbol")}<span class="connection-dot ${source.stale ? "refreshing" : source.connected ? "connected" : ""}" role="img" aria-label="${source.stale ? "Refreshing signal status" : source.connected ? "Signal detected" : "No signal"}"></span></span><span class="input-copy"><strong>${e(label)}</strong>${label === port ? "" : `<small>${e(port)}</small>`}</span>`,
  );
}
function selectedWallpaper(): Wallpaper {
  return (
    wallpapers.find((w) => w.id === (temporaryWallpaper || prefs.wallpaper)) ||
    wallpapers[0]
  );
}
function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    toast("Your monitor could not save this change.", { tone: "error" });
  }
  applyAppearance();
}
function applyAppearance(): void {
  stage.style.setProperty("--wall-dim", String(prefs.dim));
}
let cancelWallpaper: (() => void) | undefined;
function applyWallpaper(): void {
  const w = selectedWallpaper();
  const request = ++wallRequest;
  cancelWallpaper?.();
  cancelWallpaper = loadWallpaper(
    w,
    () => {
      if (request !== wallRequest) return;
      document.querySelector<HTMLElement>("#wallpaper")!.style.backgroundImage =
        `url("${w.image}")`;
      stage.style.setProperty(
        "--frost-image",
        `url("${new URL(w.blur, document.baseURI).href}")`,
      );
      applyAppearance();
      alignFrost();
    },
    () => {
      if (request === wallRequest)
        toast("That wallpaper could not be loaded.", { tone: "error" });
    },
  );
}
let frostFrame = 0;
function alignFrost(): void {
  if (frostFrame || document.hidden) return;
  frostFrame = requestAnimationFrame(() => {
    frostFrame = 0;
    const parent = stage.getBoundingClientRect();
    const scale = parent.width / 1920;
    if (!scale) return;
    // Sample every animation frame while a surface moves, including focus lift
    // and interrupted reorders. The image is already blurred; only its crop changes.
    // Batch layout reads before writes and skip offscreen/inert material surfaces.
    const samples = Array.from(stage.querySelectorAll<HTMLElement>(".frost"))
      .filter((el) => el.offsetWidth > 0 && !el.closest("[inert]"))
      .map((el) => ({
        el,
        rect: el.getBoundingClientRect(),
        width: el.offsetWidth,
        moving: [el, el.closest(".card-slot")].some((surface) =>
          surface
            ?.getAnimations()
            .some((animation) => animation.playState === "running"),
        ),
      }))
      .filter(
        ({ rect }) =>
          rect.right > parent.left &&
          rect.left < parent.right &&
          rect.bottom > parent.top &&
          rect.top < parent.bottom,
      );
    for (const { el, rect, width } of samples) {
      // Compensate for the card's focus scale as well as the stage scale so
      // the wallpaper stays stationary behind the enlarged surface, too.
      const materialScale = rect.width / width;
      if (!materialScale) continue;
      el.style.setProperty(
        "--sample-x",
        `${-(rect.left - parent.left) / materialScale}px`,
      );
      el.style.setProperty(
        "--sample-y",
        `${-(rect.top - parent.top) / materialScale}px`,
      );
      el.style.setProperty(
        "--sample-width",
        `${parent.width / materialScale}px`,
      );
      el.style.setProperty(
        "--sample-height",
        `${parent.height / materialScale}px`,
      );
    }
    // No idle loop: take one final sample when motion settles, then stop.
    if (samples.some(({ moving }) => moving)) alignFrost();
  });
}
stage.addEventListener("transitionrun", (event) => {
  if (
    event.propertyName === "transform" &&
    event.target instanceof HTMLElement &&
    event.target.classList.contains("frost")
  )
    alignFrost();
});
function fit(): void {
  // Native surface comes from the reviewed profile, not panel resolution or
  // overflow-inflated innerWidth/visualViewport. Keep the 1920x1080 design stage.
  if (platform.native) {
    for (const element of [document.documentElement, document.body, root]) {
      element.style.width = `${surface.width}px`;
      element.style.height = `${surface.height}px`;
    }
    stage.style.left = "0";
    stage.style.top = "0";
    stage.style.transformOrigin = "0 0";
    stage.style.transform =
      surface.width === 1920 ? "none" : `scale(${surface.width / 1920})`;
    requestAnimationFrame(() => {
      alignFrost();
      focus.invalidate();
      positionContext();
    });
    return;
  }
  const width =
    window.visualViewport?.width || document.documentElement.clientWidth;
  const height =
    window.visualViewport?.height || document.documentElement.clientHeight;
  const scale = Math.min(width / 1920, height / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  requestAnimationFrame(() => {
    alignFrost();
    focus.invalidate();
    positionContext();
  });
}
function timeText(now: Date): string {
  return now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(prefs.clockFormat === "system"
      ? {}
      : { hour12: prefs.clockFormat === "12" }),
  });
}
function updateClock(): void {
  const clock = scene.querySelector<HTMLElement>("[data-clock]"),
    date = scene.querySelector<HTMLElement>("[data-date]");
  if (!clock && !date) return;
  const now = new Date();
  if (clock) {
    const text = timeText(now);
    if (clock.textContent !== text) clock.textContent = text;
  }
  if (date) {
    const text = now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    if (date.textContent !== text) date.textContent = text;
  }
}
function toast(
  message: string,
  {
    tone = "info",
    duration = TOAST_MS,
  }: { tone?: ToastTone; duration?: number } = {},
): void {
  const el = document.querySelector<HTMLElement>("#toast")!;
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer =
    duration > 0
      ? window.setTimeout(() => el.classList.remove("show"), duration)
      : 0;
}
function listedApps(): AppInfo[] {
  return ordered(
    apps,
    moving?.kind === "apps" ? moving.order : prefs.appOrder,
    (a) => a.id,
  );
}
function listedInputs(): Source[] {
  return ordered(
    inputs,
    moving?.kind === "inputs" ? moving.order : prefs.inputOrder,
    sourceId,
  );
}
function section(kind: "apps" | "inputs"): string {
  const tiles =
    kind === "apps"
      ? listedApps()
          .filter((a) => prefs.apps[a.id]?.visible !== false)
          .map((a) => appCard(a))
          .join("")
      : listedInputs()
          .filter((s) => prefs.inputs[sourceId(s)]?.visible !== false)
          .map(inputCard)
          .join("");
  return tiles
    ? `<section class="shelf" data-shelf="${kind}" aria-label="${kind === "apps" ? "Apps" : "Inputs"}"><h2>${kind === "apps" ? "Apps" : "Inputs"}</h2><div class="shelf-window"><div class="shelf-track">${tiles}</div></div></section>`
    : "";
}
function renderHome(): string {
  const order = prefs.homeOrder;
  const shelves = order.map(section).join("");
  const fallback = initialDiscovery
    ? '<div class="empty-state" role="status" aria-busy="true"><p>Loading apps and inputs…</p></div>'
    : `<div class="empty-state"><p>Enable apps or inputs in Settings.</p>${button("setup", "settings", "Open Settings", "action-button", "top")}</div>`;
  return `<div class="home"><header class="home-header"><div class="identity">${prefs.clock ? '<div class="clock" data-clock></div>' : ""}${prefs.date ? '<div class="date" data-date></div>' : ""}</div><nav class="top-controls" aria-label="Home controls">${prefs.samsungHome ? button("native-home", "native-home", `${icon("home")}<span>Samsung Home</span>`, "top-button", "top") : ""}${button("all-apps", "all", `${icon("apps")}<span>All apps</span>`, "top-button", "top")}${button("settings", "settings", icon("settings"), "top-button square", "top", 'aria-label="Settings"')}</nav></header><div class="shelves">${shelves || fallback}</div></div>`;
}
function renderAll(): string {
  return `<div class="all-page"><header class="page-heading"><h1>All apps</h1>${button("all-back", "home", icon("close"), "top-button square", "all-top", 'aria-label="Close All apps"')}</header><div class="all-grid">${
    appList()
      .map((a) => appCard(a, "all-grid"))
      .join("") || "<p>No apps found.</p>"
  }</div></div>`;
}
function toggle(on: boolean): string {
  return `<span class="toggle ${on ? "on" : ""}" aria-hidden="true"><span></span></span>`;
}
function settingRow(
  id: string,
  title: string,
  value: string | boolean,
  description = "",
): string {
  return button(
    `setting:${id}`,
    id,
    `<span class="row-copy"><strong>${e(title)}</strong>${description ? `<small>${e(description)}</small>` : ""}</span>${typeof value === "boolean" ? toggle(value) : `<span class="setting-value">${e(value)}</span>`}`,
    "setting-row",
    "settings-list",
    typeof value === "boolean" ? `role="switch" aria-checked="${value}"` : "",
  );
}
function manager(kind: "apps" | "inputs"): string {
  const items =
    kind === "apps"
      ? appList().map((a) => ({
          id: a.id,
          label: appLabel(a),
          detail: "",
          visible: prefs.apps[a.id]?.visible !== false,
          art: appImage(a),
        }))
      : inputList().map((s) => ({
          id: sourceId(s),
          label: inputLabel(s),
          detail: inputLabel(s) !== sourceName(s) ? sourceName(s) : "",
          visible: prefs.inputs[sourceId(s)]?.visible !== false,
          art: icon(inputSymbol(s)),
        }));
  return `<div class="manager-list">${items.map((i) => button(`manage:${i.id}`, "toggle-item", `<span class="manager-art">${i.art}</span><span class="row-copy"><strong>${e(i.label)}</strong>${i.detail ? `<small>${e(i.detail)}</small>` : ""}</span>${toggle(i.visible)}`, "manager-row", "settings-list", `data-kind="${kind}" data-id="${e(i.id)}" role="switch" aria-checked="${i.visible}"`)).join("") || '<p class="empty-state">No items found.</p>'}</div>`;
}
function content(): string {
  switch (category) {
    case "layout":
      return `<div class="settings-rows">${settingRow("order", "Section order", "Reorder")}${settingRow("samsung-home", "Show Samsung Home", prefs.samsungHome)}${settingRow("clock", "Clock", prefs.clock)}${settingRow("date", "Date", prefs.date)}${settingRow("clock-format", "Time format", prefs.clockFormat === "system" ? "System" : `${prefs.clockFormat}-hour`)}</div>`;
    case "apps":
    case "inputs":
      return manager(category);
    case "wallpaper":
      return `<div class="settings-rows wallpaper-options">${settingRow("wallpaper-mode", "Automatic rotation", prefs.wallpaperMode === "rotate")}${prefs.wallpaperMode === "rotate" ? settingRow("rotation", "Change every", `${prefs.rotationMinutes} minutes`) : ""}</div><div class="wallpaper-grid">${wallpapers.map((w) => button(`wallpaper:${w.id}`, "wallpaper-preview", `<span class="wallpaper-thumb" data-focus-face><img src="${e(w.thumb)}" alt="" loading="lazy"/></span>${prefs.wallpaper === w.id ? `<span class="wallpaper-check">${icon("check")}</span>` : ""}<span class="wallpaper-label">${e(w.title)}</span>`, "wallpaper-option", "wallpapers", `data-id="${e(w.id)}" aria-pressed="${prefs.wallpaper === w.id}"`)).join("")}</div>`;
    case "system":
      return `<div class="settings-rows">${settingRow("native-home", "Samsung Home", "Open")}${settingRow("refresh", "Refresh apps and inputs", "Refresh")}${settingRow("credits", "Credits", "View")}${settingRow("reset", "Reset Prism", "Reset")}</div><div class="about"><img src="./icon.png" alt=""/><span>Prism <small>0.2.10</small></span></div>`;
  }
}
function renderSettings(): string {
  return `<div class="settings-page"><aside class="settings-rail"><h1>Settings</h1><nav aria-label="Settings categories">${categories.map((c) => button(`category:${c.id}`, "category", `${icon(c.symbol)}<span>${c.label}</span>`, `category ${c.id === category ? "active" : ""}`, "categories", `data-id="${c.id}" aria-current="${c.id === category ? "page" : "false"}"`)).join("")}</nav></aside><section class="settings-detail"><header class="detail-heading"><h2>${categories.find((c) => c.id === category)!.label}</h2>${button("settings-close", "home", icon("close"), "top-button square", "detail-top", 'aria-label="Close Settings"')}</header><div class="detail-scroll">${content()}</div></section></div>`;
}
function bindImages(): void {
  stage
    .querySelectorAll<HTMLImageElement>("img[data-app-image]")
    .forEach((img) => {
      const success = (): void => {
        if (img.naturalWidth) {
          img.parentElement?.classList.add("has-image");
          resolvedIcons.set(img.dataset.appId!, img.getAttribute("src")!);
        }
      };
      img.onload = success;
      img.onerror = () => {
        const path = img.getAttribute("src") || "";
        failedIcons.add(path);
        if (resolvedIcons.get(img.dataset.appId!) === path)
          resolvedIcons.delete(img.dataset.appId!);
        const app = apps.find((a) => a.id === img.dataset.appId),
          next = app && artworkCandidates(app).find((p) => !failedIcons.has(p));
        if (next) img.src = next;
        else {
          img.parentElement?.classList.remove("has-image");
          img.remove();
        }
      };
      if (img.complete) {
        if (img.naturalWidth) success();
        else if (img.getAttribute("src")) img.onerror?.(new Event("error"));
      }
    });
}
function finishRender(): void {
  applyAppearance();
  bindImages();
  updateClock();
  focus.invalidate();
  alignFrost();
  scene
    .querySelectorAll(".shelf-window,.detail-scroll,.all-grid")
    .forEach((el) =>
      el.addEventListener("scroll", alignFrost, { passive: true }),
    );
}
function bodyIds(): string[] {
  return [...focus.ids("settings-list"), ...focus.ids("wallpapers")];
}
function focusBody(): void {
  if (!focus.focus(settingsFocus.get(category)))
    focus.focus(bodyIds()[0] || "settings-close");
}
function render(target?: string, reset = false): void {
  const oldId = reset ? undefined : target || focus.id,
    oldGroup = reset ? "" : focus.group,
    oldIndex = reset ? -1 : focus.ids(oldGroup).indexOf(focus.id || "");
  scene.innerHTML =
    page === "home"
      ? renderHome()
      : page === "all-apps"
        ? renderAll()
        : renderSettings();
  scene.toggleAttribute("inert", !!dialog);
  finishRender();
  if (dialog) {
    if (dialog.kind === "item") {
      const anchor = Array.from(
        scene.querySelectorAll<HTMLElement>(".card"),
      ).find((el) => el.dataset.focus === dialog?.returnTo);
      anchor?.classList.add("context-anchor");
      anchor?.setAttribute("aria-expanded", "true");
      positionContext();
    }
    return;
  }
  if (oldId && focus.focus(oldId, true)) return;
  const fallback = focus.ids(oldGroup);
  if (oldIndex >= 0 && fallback.length) {
    focus.focus(fallback[Math.min(oldIndex, fallback.length - 1)], true);
    return;
  }
  if (page === "home") {
    if (!focus.focus(homeFocus, true))
      focus.focus(
        scene.querySelector<HTMLElement>(".shelf [data-focus]")?.dataset
          .focus || "settings",
        true,
      );
  } else if (page === "settings") focus.focus(`category:${category}`, true);
  else focus.focus(focus.ids("all-grid")[0] || "all-back", true);
}
function selectCategory(next: Category): void {
  if (category === next) return;
  category = next;
  scene.querySelectorAll<HTMLElement>(".category").forEach((el) => {
    const active = el.dataset.id === category;
    el.classList.toggle("active", active);
    el.setAttribute("aria-current", active ? "page" : "false");
  });
  scene.querySelector<HTMLElement>(".detail-heading h2")!.textContent =
    categories.find((c) => c.id === category)!.label;
  const pane = scene.querySelector<HTMLElement>(".detail-scroll")!;
  pane.innerHTML = content();
  pane.scrollTop = 0;
  finishRender();
}
function preference(kind: "apps" | "inputs", id: string): ItemPreference {
  const map = kind === "apps" ? prefs.apps : prefs.inputs;
  return map[id] || (map[id] = { visible: true });
}
function home(): void {
  press.cancel();
  const wasPreview = temporaryWallpaper !== null;
  clearDialog();
  moving = null;
  page = "home";
  if (wasPreview) applyWallpaper();
  render(homeFocus);
}
function clearDialog(): void {
  stage.removeAttribute("data-context-open");
  scene.querySelectorAll<HTMLElement>(".context-anchor").forEach((el) => {
    el.classList.remove("context-anchor");
    el.removeAttribute("aria-expanded");
  });
  dialog = null;
  temporaryWallpaper = null;
  dialogHost.innerHTML = "";
  scene.removeAttribute("inert");
  focus.invalidate();
}
function closeDialog(): void {
  const target = dialog?.returnTo,
    wasPreview = dialog?.kind === "wallpaper";
  clearDialog();
  if (wasPreview) applyWallpaper();
  if (!focus.focus(target, true)) render(target);
}
function choice(
  title: string,
  options: Option[],
  value: string,
  select: (value: string) => void,
): void {
  dialog = {
    kind: "choice",
    title,
    options,
    value,
    select,
    returnTo: focus.id,
  };
  renderDialog();
}
function editItem(target: HTMLElement): void {
  if (
    !target.isConnected ||
    page !== "home" ||
    !target.classList.contains("card") ||
    moving
  )
    return;
  dialog = {
    kind: "item",
    itemKind: target.dataset.kind as "apps" | "inputs",
    id: target.dataset.id!,
    returnTo: target.dataset.focus,
  };
  renderDialog();
}
function renderDialog(): void {
  if (!dialog) return;
  scene.setAttribute("inert", "");
  let body = "",
    target = "";
  if (dialog.kind === "choice") {
    const d = dialog;
    body = `<div class="dialog-panel"><h2>${e(d.title)}</h2><div class="dialog-scroll">${d.options.map((o, i) => button(`option:${i}`, "dialog-option", `<span>${e(o.label)}</span>${o.value === d.value ? icon("check") : ""}`, "dialog-option", "dialog-list", `data-value="${e(o.value)}"`)).join("")}</div></div>`;
    target = `option:${Math.max(
      0,
      d.options.findIndex((o) => o.value === d.value),
    )}`;
  } else if (dialog.kind === "item") {
    const anchor = Array.from(
      scene.querySelectorAll<HTMLElement>(".card"),
    ).find((el) => el.dataset.focus === dialog?.returnTo);
    anchor?.classList.add("context-anchor");
    anchor?.setAttribute("aria-expanded", "true");
    stage.setAttribute("data-context-open", "");
    body = `<div class="context-panel" role="menu" aria-label="Tile actions">${button("item-move", "item-move", "Move", "dialog-option", "dialog-list", 'role="menuitem"')}${button("item-hide", "item-hide", "Hide", "dialog-option", "dialog-list", 'role="menuitem"')}${dialog.itemKind === "inputs" ? button("item-label", "item-label", "Edit label", "dialog-option", "dialog-list", 'role="menuitem"') : ""}</div>`;
    target = "item-move";
  } else if (dialog.kind === "wallpaper") {
    const w = wallpapers.find(
      (w) => w.id === (dialog?.kind === "wallpaper" ? dialog.id : ""),
    )!;
    body = `<div class="wallpaper-preview" style="background-image:url('${e(w.image)}')"><div class="preview-title">${e(w.title)}</div><div class="preview-bar"><span class="image-credit">${e(w.credit)}</span><div class="preview-actions">${button("preview-prev", "preview-prev", icon("back"), "action-button icon-button", "preview-actions", 'aria-label="Previous wallpaper"')}${button("preview-next", "preview-next", icon("arrow"), "action-button icon-button", "preview-actions", 'aria-label="Next wallpaper"')}${button("preview-apply", "preview-apply", "Apply", "action-button", "preview-actions")}${button("preview-cancel", "dialog-close", "Cancel", "action-button", "preview-actions")}</div></div></div>`;
    target = "preview-apply";
  } else if (dialog.kind === "label") {
    body = `<div class="dialog-panel label-panel"><h2>Input label</h2><label for="input-label">Label</label><input id="input-label" data-focus="label-input" data-group="label-form" value="${e(dialog.value)}" maxlength="80" autocomplete="off"/>${popupFooter(
      [
        { id: "label-save", action: "label-save", label: "Save" },
        { id: "label-cancel", action: "dialog-close", label: "Cancel" },
      ],
      "label-actions",
    )}</div>`;
    target = "label-input";
  } else if (dialog.kind === "sections") {
    const d = dialog;
    body = `<div class="dialog-panel section-panel"><h2>Section order</h2><p>Use the arrows to reorder sections.</p><div class="section-list">${d.order
      .map(
        (id, index) =>
          `<div class="section-row" data-key="section:${id}"><span class="section-name">${homeSections.find((s) => s.id === id)!.label}</span><div class="section-tools">${sectionDirections(
            index,
            d.order.length,
          )
            .map(({ direction, disabled }) =>
              button(
                `section-${direction}:${id}`,
                `section-${direction}`,
                icon("arrow", `section-chevron ${direction}`),
                "action-button icon-button",
                "section-controls",
                `data-id="${id}" aria-label="Move ${homeSections.find((s) => s.id === id)!.label} ${direction}" ${disabled ? "disabled" : ""}`,
              ),
            )
            .join("")}</div></div>`,
      )
      .join("")}</div>${popupFooter(
      [
        { id: "sections-save", action: "sections-save", label: "Save" },
        { id: "sections-cancel", action: "dialog-close", label: "Cancel" },
      ],
      "section-actions",
    )}</div>`;
    target =
      d.order.length > 1 ? `section-down:${d.order[0]}` : "sections-save";
  } else if (dialog.kind === "credits") {
    body = `<div class="dialog-panel credits"><h2>Credits</h2><div class="credits-scroll"><p>Manrope · SIL Open Font License</p>${wallpapers.map((w) => `<article><strong>${e(w.title)}</strong><p>${e(w.credit)}</p><small>${e(w.license || "Personal image")}</small>${w.originalTitle ? `<small>Original title: ${e(w.originalTitle)}</small>` : ""}${(w.copyrightNotices || []).map((notice) => `<small>${e(notice)}</small>`).join("")}${w.source ? `<small>${e(w.source)}</small>` : ""}${w.crop ? `<small>${e(w.crop)}</small>` : ""}</article>`).join("")}</div>${popupFooter([{ id: "credits-close", action: "dialog-close", label: "Close" }], "dialog-list")}</div>`;
    target = "credits-close";
  } else {
    body = `<div class="dialog-panel"><h2>Reset Prism?</h2><p>Reset the launcher’s layout and appearance. Installed apps and monitor settings are kept.</p>${popupFooter(
      [
        { id: "confirm", action: "reset-confirm", label: "Reset" },
        { id: "cancel", action: "dialog-close", label: "Cancel" },
      ],
      "dialog-actions",
    )}</div>`;
    target = "cancel";
  }
  dialogHost.innerHTML = `<div class="${dialog.kind === "item" ? "context-backdrop" : "modal-backdrop"}">${body}</div>`;
  if (dialog.kind === "item") positionContext();
  focus.invalidate();
  focus.focus(target, true);
  if (dialog.kind === "label")
    dialogHost.querySelector<HTMLInputElement>("#input-label")?.select();
}
function positionContext(): void {
  if (dialog?.kind !== "item") return;
  const anchor = Array.from(scene.querySelectorAll<HTMLElement>(".card")).find(
    (el) => el.dataset.focus === dialog?.returnTo,
  );
  const panel = dialogHost.querySelector<HTMLElement>(".context-panel");
  if (!anchor || !panel) return;
  const face = anchor.querySelector<HTMLElement>(".card-face")!;
  const position = contextPosition(
    face.getBoundingClientRect(),
    stage.getBoundingClientRect(),
    { width: panel.offsetWidth, height: panel.offsetHeight },
  );
  panel.style.left = `${position.left}px`;
  panel.style.top = `${position.top}px`;
}
function change<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
  id: string,
): void {
  prefs[key] = value;
  save();
  render(`setting:${id}`);
}
async function perform(action: () => Promise<void>): Promise<void> {
  if (pending) return;
  pending = true;
  try {
    await action();
  } catch (error) {
    toast(
      error instanceof Error
        ? error.message
        : "The monitor could not complete that action.",
      { tone: "error" },
    );
  } finally {
    pending = false;
  }
}
function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    bootError = "";
    const results = await Promise.allSettled([
      platform.apps(),
      platform.sources(),
    ]);
    if (results[0].status === "fulfilled") apps = results[0].value;
    else bootError = "Apps could not be refreshed.";
    if (results[1].status === "fulfilled") inputs = results[1].value;
    else bootError = "Inputs could not be refreshed.";
    if (platform.native) saveCatalog(catalogStorage, { apps, inputs });
    if (moving) {
      // Incorporate newly discovered identities without disturbing the move transaction.
      const ids =
        moving.kind === "apps" ? apps.map((a) => a.id) : inputs.map(sourceId);
      moving.order = [
        ...moving.order.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !moving!.order.includes(id)),
      ];
    }
    const first =
      initialDiscovery &&
      page === "home" &&
      !cachedCatalog.apps.length &&
      !cachedCatalog.inputs.length;
    const target = first ? undefined : focus.id;
    initialDiscovery = false;
    if (first) homeFocus = undefined;
    render(target, first);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}
function handleAction(el: HTMLElement): void {
  const action = el.dataset.action,
    id = el.dataset.id || "",
    value = el.dataset.value || "";
  if (!action) return;
  switch (action) {
    case "home":
      home();
      break;
    case "all":
      homeFocus = focus.id;
      page = "all-apps";
      render();
      break;
    case "settings":
      homeFocus = focus.id;
      page = "settings";
      render(`category:${category}`);
      break;
    case "category":
      selectCategory(id as Category);
      focusBody();
      break;
    case "launch":
      void perform(() => platform.launch(id));
      break;
    case "input": {
      const source = inputs.find((s) => sourceId(s) === id);
      if (source && !pending) {
        const label = inputLabel(source),
          port = sourceName(source);
        toast(`Switching to ${label}${label === port ? "" : ` (${port})`}…`, {
          tone: "progress",
        });
        void perform(() => platform.switchSource(source));
      }
      break;
    }
    case "toggle-item": {
      const pref = preference(el.dataset.kind as "apps" | "inputs", id);
      pref.visible = !pref.visible;
      save();
      render(`manage:${id}`);
      break;
    }
    case "item-move":
      if (dialog?.kind === "item") {
        const { itemKind, id, returnTo } = dialog;
        clearDialog();
        moving = {
          kind: itemKind,
          id,
          order:
            itemKind === "apps"
              ? appList().map((a) => a.id)
              : inputList().map(sourceId),
        };
        render(returnTo);
      }
      break;
    case "item-hide":
      if (dialog?.kind === "item") {
        const { itemKind, id } = dialog;
        const cards = Array.from(
          scene.querySelectorAll<HTMLElement>(
            `.shelf [data-group="${itemKind}"]`,
          ),
        );
        const index = cards.findIndex((el) => el.dataset.id === id);
        const next =
          cards[index + 1]?.dataset.focus || cards[index - 1]?.dataset.focus;
        clearDialog();
        preference(itemKind, id).visible = false;
        save();
        homeFocus = next;
        render(next || firstOtherShelfId(itemKind), true);
      }
      break;
    case "dialog-close":
      closeDialog();
      break;
    case "dialog-option":
      if (dialog?.kind === "choice") {
        const select = dialog.select;
        closeDialog();
        select(value);
      }
      break;
    case "item-label":
      if (dialog?.kind === "item" && dialog.itemKind === "inputs") {
        const { id, returnTo } = dialog;
        const source = inputs.find((s) => sourceId(s) === id);
        if (!source) break;
        const value = inputLabel(source);
        clearDialog();
        dialog = { kind: "label", id, value, returnTo };
        renderDialog();
      }
      break;
    case "label-save":
      if (dialog?.kind === "label") {
        const { id, returnTo } = dialog;
        const value = dialogHost
          .querySelector<HTMLInputElement>("#input-label")!
          .value.trim()
          .slice(0, 80);
        const pref = preference("inputs", id);
        if (value) pref.label = value;
        else delete pref.label;
        clearDialog();
        save();
        render(returnTo);
      }
      break;
    case "order":
      dialog = {
        kind: "sections",
        order: [...prefs.homeOrder],
        returnTo: focus.id,
      };
      renderDialog();
      break;
    case "section-up":
    case "section-down":
      moveSection(id as HomeSection, action === "section-up" ? -1 : 1);
      break;
    case "sections-save":
      if (dialog?.kind === "sections") {
        const target = dialog.returnTo;
        prefs.homeOrder = [...dialog.order];
        clearDialog();
        save();
        render(target);
      }
      break;
    case "samsung-home":
      change("samsungHome", !prefs.samsungHome, "samsung-home");
      break;
    case "clock":
      change("clock", !prefs.clock, "clock");
      break;
    case "date":
      change("date", !prefs.date, "date");
      break;
    case "clock-format":
      choice(
        "Time format",
        [
          { label: "System", value: "system" },
          { label: "12-hour", value: "12" },
          { label: "24-hour", value: "24" },
        ],
        prefs.clockFormat,
        (v) =>
          change(
            "clockFormat",
            v as Preferences["clockFormat"],
            "clock-format",
          ),
      );
      break;
    case "wallpaper-mode":
      prefs.wallpaperChangedAt = Date.now();
      change(
        "wallpaperMode",
        prefs.wallpaperMode === "single" ? "rotate" : "single",
        "wallpaper-mode",
      );
      break;
    case "rotation":
      choice(
        "Change every",
        [5, 15, 30, 60].map((n) => ({
          label: `${n} minutes`,
          value: String(n),
        })),
        String(prefs.rotationMinutes),
        (v) => {
          prefs.wallpaperChangedAt = Date.now();
          change("rotationMinutes", Number(v), "rotation");
        },
      );
      break;
    case "wallpaper-preview":
      dialog = { kind: "wallpaper", id, returnTo: focus.id };
      temporaryWallpaper = id;
      renderDialog();
      break;
    case "preview-prev":
    case "preview-next":
      previewNext(action === "preview-next" ? 1 : -1);
      break;
    case "preview-apply":
      if (dialog?.kind === "wallpaper") {
        prefs.wallpaper = dialog.id;
        prefs.wallpaperChangedAt = Date.now();
        save();
        clearDialog();
        applyWallpaper();
        render(`wallpaper:${prefs.wallpaper}`);
      }
      break;
    case "native-home":
      void perform(() => platform.samsungHome());
      break;
    case "refresh":
      toast("Refreshing apps and inputs…", {
        tone: "progress",
        duration: 0,
      });
      void refresh()
        .then(() =>
          toast(bootError || "Apps and inputs refreshed.", {
            tone: bootError ? "error" : "success",
          }),
        )
        .catch(() =>
          toast("Apps and inputs could not be refreshed.", { tone: "error" }),
        );
      break;
    case "credits":
      dialog = { kind: "credits", returnTo: focus.id };
      renderDialog();
      break;
    case "reset":
      dialog = { kind: "confirm", returnTo: focus.id };
      renderDialog();
      break;
    case "reset-confirm":
      prefs = defaults();
      clearDialog();
      save();
      applyWallpaper();
      home();
      toast("Successfully reset all settings to default.", {
        tone: "success",
      });
      break;
  }
}
function moveSection(id: HomeSection, delta: number): void {
  if (dialog?.kind !== "sections") return;
  const index = dialog.order.indexOf(id);
  if (index < 0 || index + delta < 0 || index + delta >= dialog.order.length)
    return;
  const before = captureOrder(dialogHost),
    scale = stage.getBoundingClientRect().width / 1920;
  dialog.order = moveId(dialog.order, id, delta) as HomeSection[];
  renderDialog();
  if (!focus.focus(`section-${delta < 0 ? "up" : "down"}:${id}`, true))
    focus.focus(`section-${delta < 0 ? "down" : "up"}:${id}`, true);
  animateOrder(dialogHost, before, scale);
}
function previewNext(delta: number): void {
  if (dialog?.kind !== "wallpaper") return;
  const index = wallpapers.findIndex(
    (w) => w.id === (dialog?.kind === "wallpaper" ? dialog.id : ""),
  );
  dialog.id =
    wallpapers[(index + delta + wallpapers.length) % wallpapers.length].id;
  temporaryWallpaper = dialog.id;
  renderDialog();
}
function back(): void {
  press.cancel();
  if (dialog) {
    closeDialog();
    return;
  }
  if (moving) {
    const id = `${moving.kind === "apps" ? "app" : "input"}:${moving.id}`;
    moving = null;
    renderReorder(id);
    return;
  }
  if (page !== "home") home();
}
function navigate(direction: Direction): void {
  if (dialog) {
    if (dialog.kind === "sections") {
      if (focus.group === "section-controls") {
        if (!focus.moveWithin(direction) && direction === "down")
          focus.focus("sections-save");
        return;
      }
      if (direction === "up") focus.moveSpatial("up");
      else focus.moveWithin(direction);
      return;
    }
    if (dialog.kind === "label") {
      if (focus.group === "label-form" && direction === "down")
        focus.focus("label-save");
      else focus.moveSpatial(direction);
      return;
    }
    if (
      dialog.kind === "wallpaper" &&
      (direction === "left" || direction === "right")
    ) {
      previewNext(direction === "right" ? 1 : -1);
      return;
    }
    if (
      dialog.kind === "credits" &&
      (direction === "up" || direction === "down")
    ) {
      const scroll = dialogHost.querySelector<HTMLElement>(".credits-scroll");
      if (scroll) scroll.scrollTop += direction === "down" ? 180 : -180;
      return;
    }
    focus.moveSpatial(direction);
    return;
  }
  if (moving) {
    if (direction === "left" || direction === "right")
      moveHomeCard(direction === "left" ? -1 : 1);
    return;
  }
  const group = focus.group;
  if (page === "home") {
    if (group === "top") {
      if (direction === "left") focus.moveSpatial("left");
      else if (direction === "right") focus.moveWithin("right");
      else focus.moveSpatial(direction);
      return;
    }
    if (direction === "left" || direction === "right") {
      if (focus.moveWithin(direction)) return;
      if (direction === "right") focus.focus(focus.nearest("top"));
      return;
    }
    focus.moveSpatial(direction);
    return;
  }
  if (page === "all-apps") {
    if (group === "all-top") {
      if (direction === "down") focus.moveSpatial("down");
      return;
    }
    if (!focus.moveWithin(direction)) {
      if (direction === "right") {
        const ids = focus.ids("all-grid");
        const index = ids.indexOf(focus.id || "");
        focus.focus(ids[index + 1] || "all-back");
      } else focus.moveSpatial(direction);
    }
    return;
  }
  if (group === "categories") {
    if (direction === "right") {
      focusBody();
      return;
    }
    if (direction === "up" || direction === "down") focus.moveWithin(direction);
    return;
  }
  if (direction === "left") {
    if (group !== "wallpapers" || !focus.moveWithin("left"))
      focus.focus(`category:${category}`);
    return;
  }
  if (group === "detail-top") {
    if (direction === "down") focus.moveSpatial("down");
    return;
  }
  if (focus.moveWithin(direction)) return;
  focus.moveSpatial(direction);
}
function renderReorder(target: string): void {
  const before = captureOrder(scene),
    scale = stage.getBoundingClientRect().width / 1920;
  render(target);
  animateOrder(scene, before, scale);
  alignFrost();
}
function moveHomeCard(delta: number): void {
  if (!moving) return;
  const visible =
    moving.kind === "apps"
      ? listedApps()
          .filter((a) => prefs.apps[a.id]?.visible !== false)
          .map((a) => a.id)
      : listedInputs()
          .filter((s) => prefs.inputs[sourceId(s)]?.visible !== false)
          .map(sourceId);
  const moved = moveId(visible, moving.id, delta);
  let i = 0;
  moving.order = moving.order.map((id) =>
    visible.includes(id) ? moved[i++] : id,
  );
  renderReorder(`${moving.kind === "apps" ? "app" : "input"}:${moving.id}`);
}
function firstOtherShelfId(kind: string): string | undefined {
  return (
    scene.querySelector<HTMLElement>(
      `.shelf [data-group="${kind === "apps" ? "inputs" : "apps"}"]`,
    )?.dataset.focus || "settings"
  );
}
function activate(el: HTMLElement): void {
  if (el.dataset.action === "move-prev" || el.dataset.action === "move-next") {
    moveHomeCard(el.dataset.action === "move-prev" ? -1 : 1);
    return;
  }

  if (moving && !dialog) {
    const target = `${moving.kind === "apps" ? "app" : "input"}:${moving.id}`;
    if (moving.kind === "apps") prefs.appOrder = moving.order;
    else prefs.inputOrder = moving.order;
    moving = null;
    save();
    render(target);
    return;
  }
  handleAction(el);
}
stage.addEventListener("click", (event) => {
  if (
    dialog?.kind === "item" &&
    event.target === dialogHost.querySelector(".context-backdrop")
  ) {
    press.cancel();
    closeDialog();
    return;
  }
  if (event.detail === 0 && Date.now() < suppressClickUntil) {
    event.preventDefault();
    return;
  }
  const el = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-action]",
  );
  if (!el || el.closest("[inert]")) return;
  press.cancel();
  el.focus({ preventScroll: true });
  activate(el);
});
stage.addEventListener("contextmenu", (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>(".card");
  if (el && page === "home" && !dialog) {
    event.preventDefault();
    press.cancel();
    el.focus({ preventScroll: true });
    editItem(el);
  }
});
stage.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse" || moving || press.id) return;
  const el = (event.target as HTMLElement).closest<HTMLElement>("[data-focus]");
  if (el && !el.closest("[inert]") && document.activeElement !== el)
    el.focus({ preventScroll: true });
});
document.addEventListener("keydown", (event) => {
  const key = remoteKey(event);
  if (key === "Home" || (homeKeyCode && event.keyCode === homeKeyCode)) {
    event.preventDefault();
    if (!event.repeat) home();
    return;
  }
  if (event.target instanceof HTMLInputElement) {
    if (event.isComposing) return;
    if (key === "Escape") {
      event.preventDefault();
      back();
    } else if (key === "Enter") {
      event.preventDefault();
      if (!event.repeat) {
        const save = dialogHost.querySelector<HTMLElement>(
          '[data-action="label-save"]',
        );
        if (save) handleAction(save);
      }
    } else if (key === "ArrowDown") {
      event.preventDefault();
      navigate("down");
    }
    return;
  }
  if (key === "Escape" || key === "Backspace") {
    event.preventDefault();
    if (!event.repeat) back();
    return;
  }
  if (key.startsWith("Arrow")) {
    event.preventDefault();
    press.cancel();
    navigate(key.slice(5).toLowerCase() as Direction);
    return;
  }
  if (key === "Tab") {
    event.preventDefault();
    press.cancel();
    const ids = focus.ids(),
      index = ids.indexOf(focus.id || "");
    focus.focus(
      ids[(index + (event.shiftKey ? -1 : 1) + ids.length) % ids.length],
    );
    return;
  }
  if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) {
    event.preventDefault();
    editItem(document.activeElement as HTMLElement);
    return;
  }
  if (key !== "Enter") return;
  event.preventDefault();
  if (event.repeat || press.id) return;
  const target = document.activeElement as HTMLElement;
  if (!target?.dataset.action || target.closest("[inert]")) return;
  const homeCard =
    page === "home" && !dialog && !moving && target.classList.contains("card");
  press.begin(
    target.dataset.focus!,
    () => {
      if (target.isConnected && !target.closest("[inert]")) activate(target);
    },
    homeCard ? () => editItem(target) : undefined,
  );
});
document.addEventListener("keyup", (event) => {
  if (remoteKey(event) === "Enter") {
    event.preventDefault();
    suppressClickUntil = Date.now() + 150;
    press.release();
  }
});
// Native Home routing can relaunch an already-foreground app without a keydown
// or visibility change. The manifest delivers MAIN requests without reloading.
window.addEventListener("appcontrol", () => {
  home();
  startTimers();
});
window.addEventListener("blur", () => press.cancel());
// Samsung can foreground the assigned launcher without dispatching appcontrol.
// Treat native foreground entry as Home, including a focus-only reactivation.
// Ordinary browser tab switches must preserve the preview's current page.
function nativeHome(): void {
  if (
    platform.native &&
    !document.hidden &&
    (page !== "home" || dialog || moving)
  )
    home();
}
window.addEventListener("focus", (event) => {
  if (event.target === window) {
    nativeHome();
    startTimers();
  }
});
scene.addEventListener("focusin", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-focus]",
  );
  if (!target) return;
  if (press.id && press.id !== target.dataset.focus && !dialog) press.cancel();
  if (page === "home") homeFocus = target.dataset.focus;
  if (page === "settings") {
    if (target.dataset.group === "categories")
      selectCategory(target.dataset.id as Category);
    else if (target.dataset.group !== "detail-top")
      settingsFocus.set(category, target.dataset.focus!);
  }
});
let clockTimer = 0,
  rotateTimer = 0;
function stopTimers(): void {
  clearInterval(clockTimer);
  clearInterval(rotateTimer);
  clockTimer = rotateTimer = 0;
}
function startTimers(): void {
  if (document.hidden) return;
  updateClock();
  if (!clockTimer) clockTimer = window.setInterval(updateClock, 1000);
  // Keep wall-clock progress while Tizen suspends the app; defer visual changes
  // during Settings/editing without postponing the saved deadline.
  if (!rotateTimer)
    rotateTimer = window.setInterval(() => {
      if (
        page !== "home" ||
        dialog ||
        moving ||
        prefs.wallpaperMode !== "rotate" ||
        Date.now() - prefs.wallpaperChangedAt < prefs.rotationMinutes * 60000
      )
        return;
      const index = wallpapers.findIndex((w) => w.id === prefs.wallpaper);
      prefs.wallpaper = wallpapers[(index + 1) % wallpapers.length].id;
      prefs.wallpaperChangedAt = Date.now();
      save();
      applyWallpaper();
    }, 10000);
}
document.addEventListener("visibilitychange", () => {
  press.cancel();
  if (document.hidden) {
    stopTimers();
    cancelAnimationFrame(frostFrame);
    frostFrame = 0;
  } else {
    nativeHome();
    startTimers();
    void refresh();
    alignFrost();
  }
});
window.addEventListener("resize", fit);
window.addEventListener("pagehide", (event) => {
  press.cancel();
  stopTimers();
  cancelAnimationFrame(frostFrame);
  frostFrame = 0;
  cancelWallpaper?.();
  if (!event.persisted) focus.destroy();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    nativeHome();
    startTimers();
    applyWallpaper();
    alignFrost();
  }
});
startTimers();
window.Prism = {
  version: "0.2.10",
  state: () => ({
    page,
    category,
    prefs: JSON.parse(JSON.stringify(prefs)),
    apps: apps.length,
    inputs: inputs.length,
    wallpaper: selectedWallpaper().id,
    native: platform.native,
    moving: !!moving,
  }),
  show: (next: Page, cat?: Category) => {
    press.cancel();
    clearDialog();
    moving = null;
    page = next;
    if (cat) category = cat;
    render();
  },
  focus: (id: string) => focus.focus(id),
  back,
  refresh,
};
save();
fit();
applyWallpaper();
render();
void refresh().then(() => {
  if (bootError) toast(bootError, { tone: "error" });
});
