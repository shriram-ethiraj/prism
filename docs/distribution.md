# Standalone distribution maintenance

`.github/workflows/ci.yml` verifies source first, creates one public payload containing both unsigned widgets and a source-built netcoreapp3.1 helper, then builds four native PyInstaller installers. The Python setup/signing code is shared with source installation. Host Python and .NET are build dependencies only.

The native matrix is Linux x64 (`ubuntu-22.04`), macOS Intel (`macos-15-intel`), macOS Apple Silicon (`macos-14`), and Windows x64 (`windows-2022`). Each archive is unpacked into a path containing spaces and its executable runs `--self-check`, `--version` and `--help` with an empty developer-tool PATH. Offline report fixtures check argument forwarding and private-state preservation, and deliberate helper corruption must fail. Native bootstrap fixture tests run on the matching runners. Host executables currently have no publisher signature/notarization; physical monitor behavior remains a separate acceptance stage.

## Local builds

Install the normal source-build prerequisites, run `npm ci` and `npm run build`, and install `requirements-installer.txt` in `.venv`. Build the native helper externally using `dotnet build tizen/native/PrismHome.csproj -c Release -o <EXTERNAL_HELPER_DIR> -p:BaseIntermediateOutputPath=<EXTERNAL_HELPER_DIR>/obj/ -p:NuGetAudit=false`. Then:

```text
python tools/distribution.py payload --output .local/distribution/payload --helper-dir <EXTERNAL_HELPER_DIR> --commit <FULL_SOURCE_COMMIT>
python tools/distribution.py build --payload .local/distribution/payload --output .local/distribution/installers --target <HOST_TARGET>
```

Use `.venv`'s Python for these commands. Target names are `linux-x64`, `macos-x64`, `macos-arm64`, and `windows-x64`; build on the matching OS/architecture. Payload output must be a new directory. Local uncommitted changes are included in a local build; only CI packages a checked-out commit for publication. Never put owner credentials, recovery records or signed widgets in a payload. The payload assembler uses an explicit public-file selection, and frozen resource lookup rejects private state inside the installed bundle, including symlink targets.

Build dependencies are pinned separately from runtime setup dependencies. PyInstaller collects the runtime, cryptographic extensions and certifi HTTPS trust bundle. Archives include Python and dependency licenses, existing vendored licenses/provenance, public Samsung CA anchors and wallpaper attribution. Vendored source hashes are unchanged.

## Publication

Only the upstream repository's `push` to `main` can enter the serialized publisher, and only that job has `contents: write`. All matrix jobs must succeed. The publisher checks every archive and checksum sidecar, matching version/commit and target filenames, and rechecks the current main commit before promoting a build. The `main-build` tag and prerelease notes identify the promoted commit. No signing credentials are needed in GitHub secrets.

`downloads.txt` is a plain-text manifest so bootstrap scripts need no Python or JSON parser. Its header is `# prism-downloads-v1`; each following line contains five space-separated fields: target, archive filename, SHA-256, full source commit, package version. Every archive filename includes its commit. The publisher uploads archives and sidecars first and replaces `downloads.txt` last. Interrupted archive uploads retain the previous manifest. GitHub asset replacement can briefly make the manifest unavailable; a failed manifest upload needs a workflow retry. Downloads fail closed on missing assets or checksum disagreement. Older commit-qualified assets remain available for in-flight downloads and manual rollback; storage cleanup is a separate maintenance operation.

The workflow uploads artifacts for every checked revision and retains them for 14 days. Release assets are publicly downloadable without a GitHub sign-in. The rolling prerelease can be advanced only by a successful main push; a manual rerun of an older commit stops if main has moved. Rerunning an already-promoted commit retains its published archives and checksums, even if rebuilt archives have different timestamps. A workflow change alone does not create a release locally.
