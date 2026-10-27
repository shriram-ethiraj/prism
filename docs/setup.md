# Setting up Prism

Read [AGENTS.md](../AGENTS.md) and [tested devices](../VERIFIED_DEVICES.md). All launcher/setup source is in this repository. The installed launcher works locally; setup requires a computer on the monitor's LAN and your own Samsung signing identity. Full setup targets Prism on physical Home and power-on, without root.

## Standalone installation

The [main-build prerelease](https://github.com/shriram-ethiraj/prism/releases/tag/main-build) provides standalone installers after the first successful full pipeline. Linux x64 uses an Ubuntu 22.04 build baseline (glibc 2.35+); macOS builds use macOS 15 Intel and macOS 14 Apple Silicon runners; Windows x64 uses Windows Server 2022 with Python 3.12. CI smoke checks establish these host environments, not universal Linux/macOS/Windows compatibility. Linux ARM64, Windows ARM64, and musl-based Linux are not supported in this version. Publisher signing and Apple notarization are not included.

On Linux/macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/shriram-ethiraj/prism/main/scripts/install.sh | sh
```

On Windows, use PowerShell rather than installing Bash:

```powershell
irm https://raw.githubusercontent.com/shriram-ethiraj/prism/main/scripts/install.ps1 | iex
```

These scripts download the current successful main build, verify SHA-256, unpack into a per-user cache, and run the existing guided setup. No administrator privileges or developer tools are needed. Linux/macOS need the usual system `curl`, `tar`, and `sha256sum` or `shasum` commands. No owner certificate is distributed; the unsigned app is customized and signed locally for your monitor using your own Samsung identity. Read the scripts before execution if desired, or use the direct-download route below.

Default cache: `~/.local/share/prism/installers` on Linux/macOS; `%LOCALAPPDATA%\Prism\installers` on Windows. Set `PRISM_INSTALL_DIR` to choose another download cache. Setup prints the executable's full path. Keep that path for subsequent commands; it is not added to PATH automatically. Private setup state retains its existing default `~/.local/share/prism` and is never stored inside the downloaded installer. Updating downloads does not replace certificates or original recovery records.

All existing setup stages and options are accepted by the executable. For example, replace `<PRISM_SETUP>` below with its printed path (quote paths containing spaces; in PowerShell prefix a quoted executable path with `&`):

```text
<PRISM_SETUP> --version
<PRISM_SETUP> --self-check
<PRISM_SETUP> discover
<PRISM_SETUP> doctor --tv <TV_IP>
<PRISM_SETUP> home --query --tv <TV_IP> --firmware <FULL_FIRMWARE>
<PRISM_SETUP> restore --tv <TV_IP> --firmware <FULL_FIRMWARE>
```

`--self-check` validates bundled resources, both unsigned widget variants, public certificate authorities, cryptographic signing dependencies and the prebuilt helper without connecting to a monitor. App installation and native Home/startup behavior retain the same exact-device guards and recovery flow described below. The helper uses the monitor's existing compatible runtime; nothing installs a new TV runtime.

To pass options through the bootstrap, save the script first and run it with arguments:

```sh
curl -fsSL https://raw.githubusercontent.com/shriram-ethiraj/prism/main/scripts/install.sh -o prism-install.sh
sh prism-install.sh doctor --tv <TV_IP>
```

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/shriram-ethiraj/prism/main/scripts/install.ps1 -OutFile prism-install.ps1
& .\prism-install.ps1 doctor --tv <TV_IP>
```

For direct download, choose the archive matching your computer on the prerelease page, compare its SHA-256 with the adjacent `.sha256` file, and extract it. On Linux/macOS, use `sha256sum <archive>` or `shasum -a 256 <archive>`; on Windows, use `Get-FileHash <archive> -Algorithm SHA256`. Open a terminal, run the extracted `prism-setup/prism-setup` (Windows: `prism-setup\prism-setup.exe`) with `--self-check`, then run it without arguments for guided setup. Never remove private state to repair a damaged download; delete only the printed cached installer version and download again.

Every `main` push runs verification, builds the helper and widgets once, and packages/smoke-tests all four hosts before publishing. Pull requests and failed runs cannot update the prerelease. Commit-qualified assets are uploaded before the download manifest is promoted; a stale run cannot promote over a newer main revision. Actions artifacts are retained for 14 days. See [distribution maintenance](distribution.md) for rebuilding and publication details.

## Prepare the computer for a source build

Install Git, Node.js 22.12+ with npm, and Python 3.10+. Use the platform's supported installers. Native Home setup also builds a short-lived helper with a host .NET 8 SDK; do not install a new runtime on the monitor. The helper targets the monitor's existing .NET Core runtime. A compatible runtime is a capability to verify, not something implied by the Tizen version.

Start with the repository installer. It creates `.venv`, installs pinned host dependencies, runs `npm ci` and `npm run build` when needed, and forwards the command to `tools/setup.py`:

```sh
git clone https://github.com/shriram-ethiraj/prism.git
cd prism
python install.py discover
```

On macOS/Linux use `python3` if `python` is not available; on Windows use `python`. The equivalent manual preparation, used by the detailed examples below, is:

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-setup.txt
npm run build
```

Windows: create the environment with `python -m venv .venv` and use `.venv\Scripts\python.exe` for commands below. PowerShell does not need environment activation. The dependency file pins standard host cryptographic libraries; protocol, certificate, and signing source and public trust anchors are included under tools/vendor/. No other launcher package or checkout is required. Every `.venv/bin/python tools/setup.py <stage> ...` example can be replaced by `python install.py <stage> ...`, which bootstraps the environment automatically.

## Record the monitor and network

On the monitor, open Settings → Support → About and record the **full model** and **full software/firmware string**. Find its LAN IP under Network Status/IP Settings. Menu wording varies. Your agent should inspect the host route to this selected address and identify the computer LAN IP. If more than one TV exists, explicitly choose the intended address; setup never picks the first discovery result.

Run `python install.py discover` to list Samsung monitors that respond to local discovery. Choose the exact model/address; discovery never selects or changes one. If there are no replies, use Network Status/IP Settings instead. DHCP can change both the monitor's and computer's addresses; recheck Host PC IP after reconnecting or restarting the computer.

The examples use `<TV_IP>` and `<FULL_FIRMWARE>` as placeholders. Replace them before executing. Do not paste placeholder text or the owner's network configuration into the monitor.

To keep these addresses stable across restarts, add DHCP reservations for both the setup computer and monitor in the router's LAN/DHCP settings. Reserve the addresses against the network adapters actually used; for Wi-Fi, use a stable device MAC on that network. Keep the devices using DHCP so the router manages the reservation. If the monitor's address changes, verify its device identity and preserve its existing certificate and original recovery records rather than capturing the currently assigned Prism state as a new original baseline.

## Developer Mode

1. Open Apps. The owner's remote route is long-press Home → number mode → **12345**. This is an owner report pending a fresh physical confirmation.
2. Another route is Apps → App Settings → **12345**, using a numeric remote or its on-screen keypad.
3. Turn Developer Mode on, enter the **setup computer's LAN IP** in Host PC IP, save, and restart the monitor. Verify Developer Mode is displayed in Apps.
4. Use the **monitor's LAN IP** for `--tv`; it is different from Host PC IP. Keep both devices on the same trusted LAN.

[Samsung's official device guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html) documents Apps/App Settings, the code, Host PC IP and reboot. It also recommends current firmware; Prism does not automatically update firmware because native compatibility/recovery is firmware-specific.

```sh
python install.py doctor --tv <TV_IP> --firmware <FULL_FIRMWARE>
```

Diagnostics contact the selected monitor's local device endpoint and developer port. They report the correct host route, confirm the configured developer IP, retrieve capabilities, and match exact public profiles. Diagnostics create only a private host setup record; they do not install or change native settings. The firmware typed from the screen is confirmed by the guarded helper before native writes. A signed web application cannot always read firmware under its current privileges.

## Private setup records and signing

By default, private state lives below `~/.local/share/prism`, in a directory selected by the monitor address and bound to a hash of its device identity. Use `--state-dir <EXTERNAL_DIRECTORY>` to choose another location. Never place state, certificate files, signed packages, or recovery snapshots inside the checkout, even in an ignored folder. A changed firmware or a different device reusing the address requires fresh external state; keep the older recovery record separately.

For a fresh installation:

```sh
.venv/bin/python tools/setup.py certificates --tv <TV_IP> --firmware <FULL_FIRMWARE>
```

Complete Samsung sign-in yourself in the browser. The tool creates author/distributor certificates, a matching password file, and the TV-specific distributor profile in external private storage. It never overwrites an existing profile. Do not give the agent your account password or verification codes.

For an existing installation, pass `--cert-dir <EXTERNAL_CERTIFICATE_DIRECTORY>` using the **same author identity**. The directory contains `author.p12`, `distributor.p12`, `password.txt`, and `device-profile.xml`. The public CA files bundled with source are trust anchors, not your author/distributor credentials. Certificate Manager is the fallback if Samsung's certificate service/login flow changes; preserve its author identity and export a matching device-specific profile in the documented format.

## Install and verify the app

```sh
.venv/bin/python tools/setup.py install --tv <TV_IP> --firmware <FULL_FIRMWARE> --launch
.venv/bin/python tools/setup.py verify --tv <TV_IP> --firmware <FULL_FIRMWARE>
```

`npm run build` produces both `Prism-<version>-1080p-unsigned.wgt` and `Prism-<version>-2160p-unsigned.wgt`. Setup selects 4K only when the exact profile has a verified 3840×2160 logical surface; 720p/1080p profiles, unverified surfaces and unknown devices use 1080p. Each package contains all fifty wallpapers at one full-size resolution, plus shared thumbnails/frost images and notices. Setup checks the resolution manifest and image hashes before signing; missing or mismatched assets require a rebuild. No panel-resolution guess or network image download is used.

Append `--cert-dir` when reusing an existing external certificate directory. The installer validates widget identity/version, inserts artwork paths and the matched logical display profile, signs in a temporary directory, stages the distributor profile, installs, and checks the installed identity/version. It preserves native identity `Prizen0001.Home` and local preferences key `prizen.preferences.v1`.

Keep the current Home/fallback launcher installed. A certificate mismatch must be resolved without deleting it or clearing saved preferences. Installation success is not proof that physical launch, input switching, Home, or startup works. Verify shows native context when a matching adapter is available; it does not claim physical observations.

## Home and startup

There is no public web-app API for assigning system Home. The reviewed non-root route uses the developer connection to run a bounded, short-lived helper as SDK UID 901. It checks exact firmware, ARM32, runtime and current state. Nothing is installed as a resident native service. See the profile's technical notes and `tizen/native/` source.

First query without setting changes:

```sh
.venv/bin/python tools/setup.py home --query --tv <TV_IP> --firmware <FULL_FIRMWARE>
```

A profile remains a **candidate** until exact-device tests and restoration are completed; see the registry for current status. For an already owner-authorized candidate-profile trial, after reviewing the adapter/source and preparing access to Samsung Home:

```sh
.venv/bin/python tools/setup.py home --trial --tv <TV_IP> --firmware <FULL_FIRMWARE>
```

A .NET SDK must be on PATH, or supply `--dotnet <HOST_SDK_EXECUTABLE>`. To build once into an external directory, use `dotnet build tizen/native/PrismHome.csproj -c Release -o <EXTERNAL_HELPER_DIRECTORY> -p:BaseIntermediateOutputPath=<EXTERNAL_INTERMEDIATE_DIRECTORY>/`, then pass `--helper-dir <EXTERNAL_HELPER_DIRECTORY>`. Build from this source and keep those files private/external.

The host binds recovery records to the actual device. It saves the original native state before writes, compares it to the live state, checks boot eligibility, performs same-value readback checks, exercises the restoration command, applies Home, then applies startup. Each write is checked immediately. The original snapshot may point at an existing third-party launcher; it is not assumed to be Samsung defaults. Firmware or unexpected-state mismatches stop the operation. Interrupted writes need query/restore before another apply. A lost transport reply is never treated as success.

For a fully guided run, omit the stage name and provide the selected device/firmware. It runs diagnostics, certificate creation/reuse, installation, and native configuration in order. Candidate adapters still need the already-authorized `--trial` selection; unsupported stages stop with an explicit incomplete result. Human observations remain necessary.

## Physical acceptance and recovery

Record each result independently, including the date, build, exact firmware and privilege context:

- Home, Settings, wallpaper grid, all-apps grid, contextual editing, and dialogs fill the screen without cropping, unintended zoom, or inaccessible focused controls. UI logical coordinates are not panel/video resolution.
- Launch representative installed apps; switch to a real connected input. Return through Samsung Home and Settings, preserving the native video path.
- Press the **physical Home button** from a streaming app and from native input. Confirm Prism appears; do not substitute a synthetic key or software visibility readback for the observation.
- Power off/on with the remote and confirm standby resume. Separately perform an owner-assisted full power-cycle/cold boot when safe, and confirm Prism without relying on a computer-side relaunch.
- Exercise restoration and verify both readback and physical Home. Restore **before uninstalling** anything assigned as Home.

```sh
.venv/bin/python tools/setup.py restore --tv <TV_IP> --firmware <FULL_FIRMWARE>
```

The restore command accepts only captured original/planned values for the settings Prism owns and refuses unrelated changes to those settings. Boot-backup and first-screen metadata are read-only observations; Samsung can update them across app launches, so they are never overwritten or compared as assignment targets. It restores changed settings and reads them back. A saved baseline is not a firmware backup or an unconditional recovery guarantee. If restore fails, keep all apps and private records intact and investigate the exact firmware; do not run an older helper with its guards removed. After successful full restore and physical checks, reapply the authorized Home trial and complete the same physical checklist. Full onboarding remains pending until those observations are recorded.

## Adapt another device

Read the closest profile as research, not as a permission to reuse its guard. Retrieve exact model, full firmware, architecture, existing native runtime and developer UID. Investigate public APIs/source for Home operation, startup eligibility, required libraries/symbols, Settings/Home destinations, and logical surface dimensions. Preserve license/provenance for reused code.

Create a separate JSON profile and technical notes. Add a bounded adapter only after establishing the non-root execution route and restoration behavior. Read-only probes and a matching baseline precede all writes. The existing adapter intentionally rejects unreviewed models/firmware; extend it with reviewed evidence and tests rather than changing a guard string alone. If no viable non-root route exists, preserve the installed app and report Home/startup incomplete.

Logical surfaces of 1280×720, 1920×1080, and 3840×2160 are supported as profile configuration. The reference profile stays fixed at 1920×1080 despite overflow-inflated browser metrics. Do not infer app dimensions from panel resolution. Validate the whole interface physically before marking fullscreen verified. No monitor picture settings are adjusted to make the UI fit.

## Connection troubleshooting

- **Python environment creation fails:** on Debian/Ubuntu, install the matching `python3-venv` package through the OS package manager, then recreate the incomplete environment. Python distributions for other platforms generally include venv/pip. Do not install project libraries globally to bypass the missing environment.

- **Wrong Host PC IP:** use the interface that routes to this monitor, not a VPN/container/guest-network address. Re-enter all four numbers, save, and restart. Check the Apps Developer Mode indicator.
- **Restart did not apply:** standby may not restart the development service. Follow the monitor's restart procedure; if necessary, arrange a safe full power disconnect/reconnect with the owner. The tool does not silently reboot it.
- **Connection refused:** check the monitor is awake, both devices share a LAN, client isolation is off, and development TCP port 26101 is reachable. Do not disable the host firewall wholesale.
- **Native callback timeout:** the short-lived helper returns over an ephemeral TCP port bound to the selected host interface. Permit that connection from the selected monitor on the trusted LAN if the firewall blocks it. Reconnect/query before retrying writes.
- **Certificate service changed:** use current Samsung developer certificate instructions and retain the author identity. Do not expose tokens or raw server replies in issues.
- **Missing native runtime/guard mismatch:** stop native setup and develop a new reviewed profile. Do not root, downgrade firmware, install a monitor runtime, or remove checks.
- **Zoom/cropping:** inspect logical surface configuration and the packaged viewport; preserve the overflow regression. A 4K panel does not prove a 4K app viewport.
- **Owned-baseline mismatch:** a live Home/startup value changed from the expected checkpoint. The error identifies the phase and, when available, the setting category without exposing private values. Preserve the original record, query/restore, and check for other active setup/app actors before another guarded attempt. Rapid restore/reapply stress on the reference device has triggered this safe abort; subsequent guarded application succeeded. Never weaken checks or replace the original baseline to force progress.
- **Setup lock after interruption:** ensure no setup process is still running before removing the external `setup.lock`. Query native state and inspect saved original/planned records before another write.

## Share a device report

```sh
.venv/bin/python tools/setup.py report --tv <TV_IP>
```

The report uses an allowlist of public identity/build labels and marks physical checks unconfirmed. Add observations yourself, review/crop any screenshot, and submit through the [device report form](https://github.com/shriram-ethiraj/prism/issues/new?template=device-report.yml). No report is automatically posted. Maintainers promote reviewed findings into [VERIFIED_DEVICES.md](../VERIFIED_DEVICES.md) and the reusable profile notes.
