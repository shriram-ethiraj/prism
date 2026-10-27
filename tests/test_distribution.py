"""Offline distribution, publication and resource-boundary checks. No real release."""
import hashlib
import json
import os
from pathlib import Path
import runpy
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import distribution
import device_registry
import installer_cli
import native_runner
import prism_runtime
import publish_installers
import setup

COMMIT = "a" * 40


def installers(directory):
    for target in distribution.TARGETS:
        suffix = ".zip" if target == "windows-x64" else ".tar.gz"
        name = f"prism-setup-{target}-{COMMIT}{suffix}"
        (directory / name).write_bytes(target.encode())
        digest = hashlib.sha256(target.encode()).hexdigest()
        (directory / (name + ".sha256")).write_text(f"{digest}  {name}\n")
        (directory / (target + ".json")).write_text(json.dumps({"target": target, "file": name,
                     "sha256": digest, "commit": COMMIT, "version": "0.2.10"}))


class DistributionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="prism-distribution-test-")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def test_manifest_requires_all_matching_archives_and_checksums(self):
        installers(self.directory)
        distribution.write_downloads(self.directory)
        self.assertEqual(len((self.directory / "downloads.txt").read_text().splitlines()), 5)
        archive = next(self.directory.glob("*.zip"))
        archive.write_bytes(b"damaged")
        with self.assertRaises(ValueError):
            distribution.write_downloads(self.directory)

    def test_manifest_rejects_mixed_revisions_and_missing_targets(self):
        installers(self.directory)
        path = self.directory / "windows-x64.json"
        row = json.loads(path.read_text())
        row["commit"] = "b" * 40
        path.write_text(json.dumps(row))
        with self.assertRaises(ValueError):
            distribution.write_downloads(self.directory)
        path.unlink()
        with self.assertRaises(FileNotFoundError):
            distribution.write_downloads(self.directory)

    def test_host_architectures_are_explicit(self):
        for system, arch, expected in (("Linux", "x86_64", "linux-x64"), ("Darwin", "arm64", "macos-arm64"),
                                       ("Darwin", "x86_64", "macos-x64"), ("Windows", "AMD64", "windows-x64")):
            with patch("distribution.platform.system", return_value=system), patch("distribution.platform.machine", return_value=arch):
                self.assertEqual(distribution.host_target(), expected)
        with patch("distribution.platform.system", return_value="Linux"), patch("distribution.platform.machine", return_value="aarch64"):
            with self.assertRaises(ValueError):
                distribution.host_target()

    def test_resources_and_private_state_cannot_escape_boundaries(self):
        resource = self.directory / "resources"
        resource.mkdir()
        (self.directory / "outside").write_text("outside")
        with patch.object(prism_runtime, "ROOT", resource):
            with self.assertRaises(ValueError):
                prism_runtime.checked_resource("../outside")
        with patch.object(setup, "INSTALL_ROOT", self.directory):
            with self.assertRaises(setup.SetupError):
                setup.external_path(resource / "certificates")
        if os.name != "nt":
            (resource / "link").symlink_to(self.directory / "outside")
            with patch.object(prism_runtime, "ROOT", resource), self.assertRaises(ValueError):
                prism_runtime.checked_resource("link")

    def test_frozen_resource_root_resolves_aliases_before_profile_validation(self):
        bundle = self.directory / "bundle"
        (bundle / "unused").mkdir(parents=True)
        resources = bundle / "prism"
        shutil.copytree(ROOT / "devices", resources / "devices")
        shutil.copytree(ROOT / "docs", resources / "docs")
        # A noncanonical path models Windows' short temp-directory aliases.
        alias = bundle / "unused" / ".."
        with patch.object(sys, "frozen", True, create=True), \
                patch.object(sys, "_MEIPASS", str(alias), create=True):
            runtime = runpy.run_path(prism_runtime.__file__)
        self.assertEqual(runtime["ROOT"], resources.resolve())
        with patch.object(device_registry, "ROOT", runtime["ROOT"]):
            self.assertTrue(device_registry.profiles())
            profile = resources / "devices/samsung-g70b-1720.json"
            record = json.loads(profile.read_text())
            outside = self.directory / "outside-evidence.md"
            outside.write_text("Outside the bundle")
            record["evidence"] = str(outside)
            profile.write_text(json.dumps(record))
            with self.assertRaisesRegex(ValueError, "missing local evidence"):
                device_registry.profiles()

    def test_profile_integrity_uses_the_catalog_without_requiring_a_specific_model(self):
        resources = self.directory / "resources"
        shutil.copytree(ROOT / "devices", resources / "devices")
        shutil.copytree(ROOT / "docs", resources / "docs")
        original = resources / "devices/samsung-g70b-1720.json"
        record = json.loads(original.read_text())
        record.update(id="fixture-monitor", model="FixtureMonitor", firmware="fixture")
        profile = original.with_name("fixture-monitor.json")
        profile.write_text(json.dumps(record))
        original.unlink()
        files = {path.relative_to(resources).as_posix() for path in resources.rglob("*") if path.is_file()}
        with patch.object(prism_runtime, "ROOT", resources), patch.object(device_registry, "ROOT", resources):
            prism_runtime.validate_profile_resources(files)
            for name in ("devices/fixture-monitor.json", "docs/devices/g70b.md"):
                with self.assertRaisesRegex(ValueError, "missing from the integrity manifest"):
                    prism_runtime.validate_profile_resources(files - {name})
            profile.unlink()
            with self.assertRaisesRegex(ValueError, "no device profiles"):
                prism_runtime.validate_profile_resources(files)

    def test_cli_offline_options_do_not_contact_a_device(self):
        with patch.object(installer_cli.setup, "main") as device, patch("builtins.print"), \
                patch.object(prism_runtime, "validate_bundle", return_value={"ok": True}) as check:
            self.assertEqual(installer_cli.main(["--version"]), 0)
            self.assertEqual(installer_cli.main(["--self-check"]), 0)
        device.assert_not_called()
        check.assert_called_once()

    def test_frozen_cli_checks_before_forwarding_arguments(self):
        events = []
        args = ["restore", "--tv", "192.168.5.8", "--state-dir", "path with spaces"]
        with patch.object(prism_runtime, "FROZEN", True), patch.object(prism_runtime, "configure_host_runtime"), \
                patch.object(prism_runtime, "validate_bundle", side_effect=lambda: events.append("checked")), \
                patch.object(installer_cli.setup, "main", side_effect=lambda value: events.append(value)):
            self.assertEqual(installer_cli.main(args), 0)
        self.assertEqual(events, ["checked", args])

    def test_frozen_native_route_uses_bundled_helper_without_dotnet(self):
        helper = self.directory / "native"
        helper.mkdir()
        for name in prism_runtime.HELPER_FILES:
            (helper / name).write_bytes(b"fixture")
        profile = {"model": "LS28BG702EWXXL", "firmware": "T-PTMLWWC-1720.7",
                   "native": {"adapter": "g70b-vconf", "runtime": "3.1.3"}}
        with patch.object(native_runner, "FROZEN", True), patch.object(native_runner, "ROOT", self.directory), \
                patch.object(native_runner, "build_helper") as build, \
                patch.object(setup, "device_info", return_value={"modelName": profile["model"]}), \
                patch.object(setup, "tool_path", side_effect=setup.SetupError("fixture stop before transport")):
            with self.assertRaisesRegex(setup.SetupError, "fixture stop"):
                native_runner.run_native(None, "192.168.5.8", profile, "query", None)
        build.assert_not_called()

    def publication(self, tip=COMMIT):
        installers(self.directory)
        calls = []
        def fake_gh(*args):
            calls.append(args)
            if "--jq" in args:
                return tip
            if "--slurp" in args:
                return "[[]]"
            return ""
        env = {"GITHUB_REPOSITORY": publish_installers.REPO, "GITHUB_EVENT_NAME": "push",
               "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": COMMIT}
        return calls, fake_gh, env

    def test_only_upstream_main_pushes_can_publish(self):
        calls, fake, env = self.publication()
        for overrides in ({"GITHUB_EVENT_NAME": "pull_request"}, {"GITHUB_REF": "refs/heads/feature"},
                          {"GITHUB_REPOSITORY": "example/fork"}, {"GITHUB_SHA": "b" * 40}):
            with patch.dict(os.environ, dict(env, **overrides)), patch.object(publish_installers, "gh", fake):
                with self.assertRaises(ValueError):
                    publish_installers.publish(self.directory, COMMIT)
        self.assertEqual(calls, [])

    def test_stale_run_does_not_publish_and_manifest_is_uploaded_last(self):
        calls, fake, env = self.publication(tip="b" * 40)
        with patch.dict(os.environ, env), patch.object(publish_installers, "gh", fake):
            publish_installers.publish(self.directory, COMMIT)
        self.assertEqual(len(calls), 1)
        calls, fake, env = self.publication()
        with patch.dict(os.environ, env), patch.object(publish_installers, "gh", fake):
            publish_installers.publish(self.directory, COMMIT)
        self.assertEqual(calls[-1][:3], ("release", "upload", "main-build"))
        self.assertIn(str(self.directory / "downloads.txt"), calls[-1])
        self.assertEqual(sum(args[:2] == ("release", "upload") for args in calls), 2)

    def test_failed_upload_never_promotes_manifest(self):
        import subprocess
        calls, fake, env = self.publication()
        def fail_upload(*args):
            if args[:2] == ("release", "upload"):
                raise subprocess.CalledProcessError(1, ["fixture-upload"])
            return fake(*args)
        with patch.dict(os.environ, env), patch.object(publish_installers, "gh", fail_upload):
            with self.assertRaises(subprocess.CalledProcessError):
                publish_installers.publish(self.directory, COMMIT)
        self.assertFalse(any(str(self.directory / "downloads.txt") in args for args in calls))
        self.assertFalse(any("PATCH" in args for args in calls))

    def test_main_advancing_during_upload_retains_previous_manifest(self):
        calls, fake, env = self.publication()
        reads = 0
        def advancing(*args):
            nonlocal reads
            if "--jq" in args:
                reads += 1
                if reads == 2:
                    calls.append(args)
                    return "b" * 40
            return fake(*args)
        with patch.dict(os.environ, env), patch.object(publish_installers, "gh", advancing):
            publish_installers.publish(self.directory, COMMIT)
        self.assertFalse(any(str(self.directory / "downloads.txt") in args for args in calls))
        self.assertFalse(any("PATCH" in args for args in calls))

    def test_rerun_of_promoted_commit_does_not_overwrite_downloads(self):
        calls, fake, env = self.publication()
        distribution.write_downloads(self.directory)
        manifest = (self.directory / "downloads.txt").read_text()
        release = {"tag_name": "main-build", "prerelease": True, "draft": False,
                   "assets": [{"id": 123, "name": "downloads.txt"}]}
        def promoted(*args):
            if "--slurp" in args:
                calls.append(args)
                return json.dumps([[release]])
            if "--header" in args:
                calls.append(args)
                return manifest
            return fake(*args)
        with patch.dict(os.environ, env), patch.object(publish_installers, "gh", promoted):
            publish_installers.publish(self.directory, COMMIT)
        self.assertFalse(any(args[0] == "release" for args in calls))
        self.assertFalse(any("PATCH" in args for args in calls))


if __name__ == "__main__":
    unittest.main()
