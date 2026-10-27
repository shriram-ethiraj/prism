# Working on Prism

Prism is a standalone, local-first fullscreen launcher for Samsung Tizen monitors. Its intended everyday behavior is Prism at power-on and on physical Home press, using non-root developer access. App installation, native routing, and physical lifecycle verification are separate stages of that outcome.

## Read first

Read README.md before implementation or device work. For setup, also read docs/setup.md, VERIFIED_DEVICES.md, and the matching devices/ profile and notes. The device registry preserves per-build physical evidence and limitations. Initial research, proposals and work diaries are archived locally under ignored experimentation/ and are not installation prerequisites. Historical proposals do not override current owner instructions.

## Repository map

- src/: TypeScript UI, focus/remote handling, local state, platform adapter. src/generated/ is generated.
- public/: packaged icons/fonts and generated wallpaper assets. assets/wallpapers/: original images and provenance.
- tizen/: application manifest and native setup-helper source. devices/: public exact-device findings, never recovery snapshots.
- install.py: cross-platform setup driver that prepares .venv/dependencies/packages and forwards stages to tools/setup.py.
- tools/: self-contained Python setup, bounded native runner, artwork parser, registry checks; vendor/ retains upstream licenses and source hashes.
- scripts/: asset preparation and unsigned widget packaging. tests/: Node, Playwright, and Python checks.
- docs/: setup instructions, distribution maintenance, device compatibility notes and README screenshots. experimentation/: ignored local research, proposals, work diaries and audit snapshots, never a build dependency. Required artwork and vendored-source provenance remains with the assets and vendor notices.

## Development and checks

Use Node.js 22.12+, npm, and Python 3.10+. Run npm ci and npm run assets before the preview (npm run dev, localhost:8765). Build both wallpaper variants with npm run build; package/browser tests need these fresh outputs. Python setup dependencies belong in .venv, installed from requirements-setup.txt; never depend on another owner's checkout or globally installed launcher tools. For user-facing installation, prefer `python install.py <stage> ...`; the driver prepares .venv/build and forwards to tools/setup.py without duplicating native safety checks.

Before delivery run npm run check, npm test, npm run test:browser, Python unittest discovery, npm run build, npm run test:packages, dotnet run --project tests/native/PrismHome.Tests.csproj, and python3 tools/device_registry.py --check. Browser tests need npx playwright install chromium. Run appropriate targeted checks while editing, then the full required suite once. Record failures and limitations accurately.

Keep TypeScript strict and compatible with the configured Chromium 85 build target. Preserve stable native application ID Prizen0001.Home and localStorage key prizen.preferences.v1. Migrate preferences without discarding user order, labels, or visibility. Preserve discovered native input descriptors; labels are not identities. Avoid arbitrary app IDs or port lists based on another monitor.

## UI and fullscreen invariants

Preserve remote-only navigation, accessible labels, Back/cancel routes, reduced-motion behavior, and a working Samsung Home/Settings escape. Keep input video on Samsung's native viewer. The verified reference logical surface is 1920×1080; panel 4K does not establish a 4K app surface. Never derive native scale from inflated innerWidth/visualViewport values. Device adaptations use verified display profiles and test the complete UI for clipping/zoom, including dialogs and enlarged focus.

## Device workflow and authorization

Research/UI changes do not authorize installation or native settings changes. When the user requests full installation, carry that authorization through diagnostics, signing, installation, guarded Home/startup setup, and recovery checks; do not repeatedly ask for the same approval. Announce disruptive stages and coordinate observations/restarts with the user. Physical observations cannot be inferred from readbacks.

1. Inspect host/network and retrieve exact model, full firmware, Tizen/web engine, architecture, runtime, privilege context, and installed app identity. Match a profile exactly.
2. Guide Developer Mode and the owner's own certificate sign-in. Never collect account passwords or login codes in chat.
3. Build, validate unsigned assets/identity, sign in an external temporary directory, install, and verify installed metadata and foreground state. Never uninstall to solve a signing mismatch.
4. Before native writes, establish a reviewed non-root runner and current-firmware helper; query capabilities and original values, save an external baseline, check it against live state, and prepare/exercise restoration. An old guard is not authorization to change its firmware string and run it.
5. Apply bounded Home and startup operations separately, read back every write, and restore changed values on failure. Detect interrupted/partial operations before retrying. Keep the existing fallback app installed.
6. Verify fullscreen, app/input use, Samsung Home/Settings, physical Home from apps/native input, standby, and cold boot with the owner. Record pending checks explicitly. Installation alone is not complete onboarding.

On unfamiliar hardware, research public source/documentation, build a separately guarded profile/adapter, validate read-only behavior and recovery, then attempt writes within authorization. Stop the unsupported stage if a viable non-root route cannot be established. Do not bypass guards, root the monitor, expose a general shell to the UI, install a persistent watcher, change firmware/security policy, or use Home-stealing polling loops. Do not modify services, picture settings, display protection, or unrelated apps as installation prerequisites.

## Device knowledge and evidence

Store reusable constants, API/library symbols, app IDs, key codes, viewport quirks, requirements, evidence links/dates, and applicability in devices/. Readback proves a setting value; it does not prove physical Home, startup, recovery, performance, or video quality. Record each separately. Historical success with another launcher is historical evidence, not a Prism pass. Tizen version alone is insufficient.

Distinguish owned settings from platform-managed observations. On the reference adapter, boot-backup/first-screen metadata can change across app launches; capture them for context but never overwrite them during apply/restore. Enforce original/planned comparisons on the Home operation, Home app ID, startup app ID and autostart flag that Prism actually writes. Preserve a bounded native-only presentation catalog for startup; cached inputs must not claim fresh signal status, and input switching must still obtain a current native descriptor.

Only mark verified results after exact-device observation. Maintain VERIFIED_DEVICES.md with tools/device_registry.py; do not inflate report/device counts. Community issue reports require review before profile promotion. Generate sanitized report drafts and let the user submit them unless posting is explicitly requested.

Never label signal Hz or launcher animation rate as game FPS. Never infer measured latency from software timers or menu labels. Preserve native video performance; do not add an embedded video/overlay path without separate display-path verification.

## Secrets, provenance, and handoff

Keep certificates, passwords, tokens, device IDs, signed widgets, raw app/device dumps, and private restoration records outside the checkout, including ignored folders. State paths are configurable and must be checked for symlink escapes. Do not print private data in errors or issue reports. Public certificate-authority trust anchors in tools/vendor/tizen/ca are upstream distribution data, not owner signing credentials.

Preserve upstream licenses and immutable revision/hash provenance when reusing source. Public code without a clear license remains reference-only. Garage Home's inspected license is noncommercial; do not import its implementation under Prism's MIT license.

No automatic commits, pushes, releases, or visibility changes. Do not reset/stage/delete the owner's existing changes. Keep documentation and historical device evidence independent of any future renderer choice. Deliver a concrete change summary, checks, device results, and any remaining physical or compatibility limitations.
