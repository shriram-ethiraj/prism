<div align="center">
  <img src="public/icon.png" alt="Prism icon" width="112" />
  <h1>Prism</h1>
  <p><strong>Your inputs. Your apps. Your home screen.</strong></p>
  <p>A local-first launcher for Samsung Tizen monitors.</p>
  <p><a href="#installation">Install</a> · <a href="#features">Features</a> · <a href="VERIFIED_DEVICES.md">Tested devices</a> · <a href="#local-development">Development</a> · <a href="LICENSE">MIT license</a></p>
</div>

![Prism Home, shown in the browser preview](docs/images/home.png)

## Why Prism

A monitor should put your computer, console, and favourite apps within easy reach. Prism gives Samsung Tizen monitors a simple fullscreen home screen built around those everyday actions, controlled with the remote you already have.

On verified device profiles, Prism opens when you power on and whenever you press Home. That integration uses device-specific native settings alongside the launcher. See [tested devices](VERIFIED_DEVICES.md) for the exact results: installation, Home, and power-on are checked separately.

## Features

- **Inputs and apps together.** Discover installed apps and the monitor's actual DisplayPort/HDMI inputs. Input selection hands video back to Samsung's native viewer.
- **Make Home yours.** Reorder and hide tiles, rename input labels, and choose the order of the Apps and Inputs sections. All Apps keeps other launchable apps accessible.
- **Made for the remote.** Clear focus, directional navigation, and a hold-OK context menu. Keyboard and mouse controls also work in the browser preview.
- **Your artwork.** Installed-app icons with fallbacks; setup discovers richer artwork already cached on the monitor.
- **Offline backgrounds.** Fifty curated wallpapers across landscapes, cities, aurora, and abstract artwork, with preview, rotation, and support for personal images when building.
- **Local preferences.** Layout, wallpapers, clock, and date settings stay in the launcher. Saved app/input identities appear at startup while discovery refreshes in the background. No Prism account or ongoing computer connection is needed for ordinary launcher use.
- **Samsung controls within reach.** Open Samsung Home from Prism, with an optional Home-screen shortcut shown by default. Native Home/startup integration is non-root and checked per device.

| Settings | Wallpapers |
| --- | --- |
| ![Prism Settings preview](docs/images/settings.png) | ![Prism wallpaper preview](docs/images/wallpapers.png) |

Screenshots show the browser preview. Hiding a tile changes Prism's layout; it does not uninstall an app or disable Samsung services.

## Installation

Use the standalone installer below, ask a local coding agent to help, or build from source. All routes share the guarded setup flow in `tools/setup.py`.

You need a Samsung Tizen monitor, its remote, and a computer on the same trusted local network. Internet access and your own Samsung sign-in are needed to obtain signing certificates. Android TV, webOS, and Roku are different platforms.

### One-command installation

Successful `main` builds publish a [rolling prerelease](https://github.com/shriram-ethiraj/prism/releases/tag/main-build). Downloads become available after the first complete installer pipeline succeeds. They include the app, Python, signing dependencies, and native helper: no Git, Node.js, Python, .NET SDK, or Tizen Studio installation is required on your computer.

**Linux x64 or macOS Intel/Apple Silicon**, in a terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/shriram-ethiraj/prism/main/scripts/install.sh | sh
```

**Windows x64**, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/shriram-ethiraj/prism/main/scripts/install.ps1 | iex
```

The bootstrap checks the download checksum, runs an offline integrity check, and opens guided setup. It prints the installed `prism-setup` path for later diagnostics, updates, or recovery. You still enable Developer Mode, enter the computer's LAN IP on the monitor, complete Samsung sign-in yourself, and observe the physical acceptance checks. Unknown model/firmware combinations require a reviewed device adaptation.

For direct download, host requirements, command arguments and recovery, see [standalone setup](docs/setup.md#standalone-installation). Main builds are prereleases; the host executables are not publisher-signed/notarized. Physical evidence in [tested devices](VERIFIED_DEVICES.md) applies only to the recorded builds and firmware.

### Easy way: use an AI agent

Any local coding agent with terminal and network access can drive the setup, for example opencode, Codex, or Claude Code. Copy this prompt:

```text
Set up Prism from https://github.com/shriram-ethiraj/prism on my Samsung Tizen monitor.
Read AGENTS.md, README.md, docs/setup.md, and VERIFIED_DEVICES.md first.
Use the repository's installer (python install.py discover, then python install.py)
instead of reimplementing the build, signing, or installation steps.
Inspect my computer and identify my monitor, exact firmware, runtime, and privileges.
Guide me through Developer Mode and my own Samsung certificate sign-in. Use the
setup code and dependency manifests in this repository; do not install another launcher.
Build and install Prism, preserve its application identity and my existing preferences,
and make Prism open on power-on and on the physical Home button without root.
Reuse matching device findings only after checking them on my device. If my device
needs adaptation, research and implement a guarded profile with recovery before writes;
do not bypass model/firmware checks. Keep all credentials and recovery data outside the repo.
Verify fullscreen fit without cropping or zoom, app/input launching, Samsung Home/Settings,
Home from apps and inputs, standby resume, and cold boot with my physical observations.
Installation alone is not completion. Report unsupported or pending steps honestly.
Generate a sanitized device report for me to review and submit; do not publish it for me.
Do not debloat, change firmware/picture settings, commit, push, or publish this repository.
```

The agent must run on your computer; a repository link alone cannot give a hosted chat access to your monitor. You still handle Samsung sign-in, the monitor's menus, and confirmation of physical Home/power-on results. The [complete setup guide](docs/setup.md) explains each stage and recovery.

### Build and install from source

1. Install Git, Node.js 22.12+ with npm, and Python 3.10+. Then clone the repository:

   ```sh
   git clone https://github.com/shriram-ethiraj/prism.git
   cd prism
   ```

2. Record the monitor's full model and full firmware from **Settings → Support → About**, and find its LAN IP under **Network Status/IP Settings**. Discovery can also list monitors that respond on the LAN:

   ```sh
   python install.py discover
   ```

   Use `python3` instead of `python` on systems that only expose that name. Discovery never selects or changes a device.

3. Print the computer's LAN IP and check the connection. This does not install anything:

   ```sh
   python install.py doctor --tv <TV_IP>
   ```

   The command prints the **Host PC IP** to enter in Developer Mode. Until Developer Mode is enabled with that address, it stops with an instruction to retry.

4. Enable Developer Mode on the monitor:
   1. Open Samsung's Apps screen. On the reference remote, **long-press Home → number mode**, then enter **12345**. Remote layouts vary.
   2. If the popup does not appear, open **Apps → App Settings** and enter **12345** with the numeric remote or on-screen keypad. Menu locations vary by firmware.
   3. Turn **Developer Mode On**. In **Host PC IP**, enter the **computer's LAN IP** printed above. This is not the monitor's IP, a public internet address, or `127.0.0.1`.
   4. Save and restart the monitor. Reopen Apps and check that Developer Mode is shown. If the change has not applied, follow the restart instructions in the [setup guide](docs/setup.md#connection-troubleshooting).

   The monitor's own IP is used by the setup command to connect to it. [Samsung's official instructions](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html) describe the Apps/App Settings route.

5. Run the guided installer:

   ```sh
   python install.py
   ```

   The installer creates `.venv`, installs pinned host dependencies, runs `npm ci` and `npm run build`, then starts the guided flow. It asks for the monitor IP and firmware, opens Samsung sign-in in your browser, creates or reuses certificates, signs and installs Prism, verifies the installed identity/version and foreground launch, and applies guarded Home/startup changes when the exact profile supports them. Complete Samsung sign-in yourself; never paste your password or verification code into chat. Native integration also needs a host .NET 8 SDK and a compatible runtime on the monitor; setup checks these before building the helper. Unknown devices require profile adaptation.

   Individual stages accept the same arguments as `tools/setup.py`:

   ```sh
   python install.py certificates --tv <TV_IP> --firmware <FULL_FIRMWARE>
   python install.py install --tv <TV_IP> --firmware <FULL_FIRMWARE> --launch
   python install.py verify --tv <TV_IP> --firmware <FULL_FIRMWARE>
   python install.py home --query --tv <TV_IP> --firmware <FULL_FIRMWARE>
   python install.py restore --tv <TV_IP> --firmware <FULL_FIRMWARE>
   ```

   Add `--no-build` to reuse packages that are already built during recovery. The lower-level equivalent on macOS/Linux is `.venv/bin/python tools/setup.py ...`; on Windows use `.venv\Scripts\python.exe`.

6. Complete the physical checks in [the setup guide](docs/setup.md#physical-acceptance-and-recovery): fullscreen fit without cropping or zoom, launching representative apps, switching to a real input, returning through Samsung Home and Settings, physical Home from apps and inputs, standby resume, and cold boot. Installation alone is not completion.

7. Generate a sanitized report for your review:

   ```sh
   python install.py report --tv <TV_IP>
   ```

   Keep the existing fallback launcher installed, preserve your original author certificate for updates, and restore native routing before uninstalling an app assigned as Home. The [complete setup guide](docs/setup.md) explains diagnostics, certificate reuse, device adaptation, and recovery.

### Compatibility

Tested on the **Samsung Odyssey G70B (LS28BG702EWXXL)**. Fullscreen rendering, app/input use, physical Home return, standby resume, cold boot, and recovery have owner-tested results in the device registry. Other Samsung Tizen monitors can be investigated using the same setup workflow, with no universal compatibility promise.

See [verified devices and reusable findings](VERIFIED_DEVICES.md). If you successfully try Prism on another monitor, [submit a device report](https://github.com/shriram-ethiraj/prism/issues/new?template=device-report.yml), including anything that did not work.

## Remote controls

| Control | Action |
| --- | --- |
| Direction pad | Move focus between tiles and controls |
| OK / Enter | Open or select |
| Hold OK | Open a tile's Move/Hide menu; inputs also offer Edit label |
| Left / Right in Move | Reorder a tile |
| OK / Back in Move | Save / cancel |
| Back / Escape | Close the current popup, cancel a move, or return to Home from Settings and All Apps |
| Settings → Home layout | Reorder sections, show/hide Samsung Home, and configure clock/date |
| Settings → System | Open Samsung Home, refresh, credits, or reset Prism preferences |

Automatic wallpaper rotation keeps its interval across app/input use and Prism restarts. An overdue change happens on Home within ten seconds; Settings, previews, and tile editing defer the change until Home is available. Hidden tiles can be enabled again in Settings. Desktop context menus also open with right-click or Shift+F10. The physical Home button needs native integration; a foreground JavaScript key handler cannot assign it globally.

## Local development

```sh
npm ci
npm run assets
npm run dev
```

Open [localhost:8765](http://127.0.0.1:8765). The preview uses fixture apps and inputs; it cannot launch real monitor apps or switch a computer's video source.

```sh
npm run build
npm run test:packages
npm run check
npm test
npx playwright install chromium
npm run test:browser
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/device_registry.py --check
dotnet run --project tests/native/PrismHome.Tests.csproj
```

The build generates compressed 1080p and 4K unsigned widgets in `packages/` (`Prism-<version>-1080p-unsigned.wgt` and `Prism-<version>-2160p-unsigned.wgt`). Setup chooses 4K only for a verified 3840×2160 logical app surface; other profiles and unknown devices use 1080p. Each installed widget contains one full-size variant per wallpaper. A 4K panel alone does not select the 4K package. Signing and installation are separate setup stages. Keep personal JPEG/PNG/WebP wallpapers in `assets/wallpapers/custom/` before building; they are ignored by Git. Bundled originals and credits are included, so ordinary builds do not download wallpaper images.

The UI uses TypeScript, DOM/CSS, Vite, and bundled assets. The reference web-engine target is Chromium 85. The monitor's logical app surface and panel/video resolution are different; fullscreen validation must check the actual device. See [contributing](CONTRIBUTING.md) for development checks.

## Troubleshooting and recovery

Start with [setup diagnostics and recovery](docs/setup.md). Certificate mismatch, connection rejection, fullscreen fit, and incomplete Home/startup checks each have separate remedies. Preserve your original author certificate for updates. Restore native routing before uninstalling any app assigned as Home.

## Contributing

Bug reports, device testing, and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for checks and the device-report process. Share exact model/firmware and observed behavior, with private information removed. See [tested devices](VERIFIED_DEVICES.md) for exact per-build physical evidence and compatibility limitations.

## License and credits

Prism's original code is [MIT licensed](LICENSE). Bundled fonts, photography, brand artwork, and reused setup primitives retain their own attribution and terms in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Prism is an independent project and is not affiliated with Samsung, NASA, or ESA.
