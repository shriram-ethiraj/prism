# Contributing to Prism

Prism welcomes fixes, documentation improvements, and testing on Samsung Tizen monitors. Read [AGENTS.md](AGENTS.md) for implementation and device-work rules.

## Develop and check

Follow [local development](README.md#local-development). Before a pull request, run:

```sh
npm ci
npm run build
npm run test:packages
npm run check
npm test
npx playwright install chromium
npm run test:browser
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/device_registry.py --check
python3 tools/release_audit.py
dotnet run --project tests/native/PrismHome.Tests.csproj
```

Changes to signing/certificate creation also need the isolated dependencies in requirements-setup.txt. CI tests device behavior with fakes; it does not connect to hardware or prove physical compatibility. Preserve saved preferences, remote accessibility, native input descriptors, and the reference overflow regression.

## App icon

The icon master is `assets/branding/prism-icon-source.png`. `npm run assets` exports it to `public/icon.png` at 256×256; `npm run build` includes this step. Preserve the square canvas and existing padding, since app drawers may apply their own masks. Artwork attribution and the master hash are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Report a device

Use the [device report form](https://github.com/shriram-ethiraj/prism/issues/new?template=device-report.yml), including partial success and failures. Start with the model, full firmware string and Prism build, then describe what works. Mark anything you did not check as not tested; runtime details and screenshots are optional. Report standby and cold boot separately, and say whether Home works from an app and an input. Recovery is optional—do not change native settings just to complete a report.

`python tools/setup.py report --tv <TV_IP>` creates a sanitized draft from the local setup record; add physical observations and review it before posting. Never attach certificates, passwords, tokens, serial numbers, DUIDs, addresses, signed packages, raw logs, or recovery files. Crop screenshots accordingly.

Maintainers review evidence, merge reusable findings into the matching exact-device profile, and regenerate VERIFIED_DEVICES.md. A firmware change is a new configuration. Accepted reports are reports, not automatically unique physical devices or downloads. Draft adaptations and browser-only checks do not count as verified hardware.

## Pull requests

Describe the concrete problem, final behavior, checks, and remaining device tests. Keep changes focused. New profiles must identify their evidence and the conditions under which constants can be reused. New native adapters require exact guards, bounded operations, baseline/readback checks, rollback tests, and a recovery procedure. Preserve notices for reused code and assets.

Original contributions use the repository's MIT license unless a file explicitly retains different compatible terms. Open an issue before introducing new runtime services, privileged backends, network listeners, or renderer changes. Do not add broad debloating or firmware modifications to setup.
