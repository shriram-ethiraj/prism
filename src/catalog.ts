import type { AppInfo } from "./types";
// Retail firmware marks many internal screens show=true. Most store/sideloaded
// apps have ordinary package IDs, while these consumer apps use OS namespaces.
// This is an eligibility exception list, never an artwork/brand registry.
const nativeConsumerApps = new Set([
  "com.samsung.tv.aria-video",
  "org.tizen.primevideo",
  "org.tizen.browser",
  "org.tizen.netflix-app",
  "org.tizen.netflix",
  "org.tizen.disneyplus",
]);
export function launchable(app: AppInfo): boolean {
  if (app.show === false || !app.name || app.id.startsWith("Prizen0001."))
    return false;
  if (
    /(daemon|service|worker|preview|^e-manual$|^emanual$|account.?extension|^cmsWebApp$)/i.test(
      app.name,
    )
  )
    return false;
  if (/(-dummy|companionapp)$/.test(app.id)) return false;
  if (/^(com\.samsung\.|org\.tizen\.|ug-)/.test(app.id))
    return nativeConsumerApps.has(app.id);
  return !!app.iconPath;
}
