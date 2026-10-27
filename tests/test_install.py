"""Offline installer-driver checks. No monitor or package installation."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import install


class InstallerDriverTests(unittest.TestCase):
    def test_stage_detection_defaults_to_guided(self):
        self.assertEqual(install.stage_from([]), "guided")
        self.assertEqual(install.stage_from(["--tv", "192.168.1.20"]), "guided")
        self.assertEqual(install.stage_from(["doctor", "--tv", "192.168.1.20"]), "doctor")
        self.assertEqual(install.stage_from(["restore"]), "restore")
        self.assertEqual(install.stage_from(["--tv", "192.168.1.20", "restore"]), "guided")
        self.assertEqual(install.stage_from(["--state-dir", "home"]), "guided")

    def test_build_is_limited_to_package_stages_and_can_be_skipped(self):
        self.assertTrue(install.needs_build("guided", []))
        self.assertTrue(install.needs_build("install", ["--tv", "192.168.1.20"]))
        for stage in ("discover", "doctor", "certificates", "home", "verify", "restore", "report"):
            with self.subTest(stage=stage):
                self.assertFalse(install.needs_build(stage, []))
        self.assertFalse(install.needs_build("guided", ["--no-build"]))

    def test_driver_flag_is_removed_before_setup_arguments_are_forwarded(self):
        self.assertEqual(install.setup_arguments(["guided", "--no-build", "--tv", "192.168.1.20"]),
                         ["guided", "--tv", "192.168.1.20"])
        self.assertEqual(install.setup_arguments(["--no-build", "discover"]), ["discover"])

    def test_version_checks_accept_padding_and_reject_old_node(self):
        self.assertTrue(install.version_at_least("v22.12.0", (22, 12, 0)))
        self.assertTrue(install.version_at_least("v23.0.0", (22, 12, 0)))
        self.assertTrue(install.version_at_least("node 22.12", (22, 12, 0)))
        self.assertFalse(install.version_at_least("v22.11.9", (22, 12, 0)))
        self.assertFalse(install.version_at_least("v20.19.0", (22, 12, 0)))
        self.assertEqual(install.version_tuple("v22.12.0"), (22, 12, 0))

    def test_venv_python_uses_platform_layout(self):
        with patch.object(install.os, "name", "nt"):
            self.assertEqual(install.venv_python(), install.VENV / "Scripts" / "python.exe")
        with patch.object(install.os, "name", "posix"):
            self.assertEqual(install.venv_python(), install.VENV / "bin" / "python")

    def test_node_dependencies_are_stale_when_missing_or_outdated(self):
        with tempfile.TemporaryDirectory(prefix="prism-install-test-") as name:
            root = Path(name)
            self.assertTrue(install.node_dependencies_stale(root))
            modules = root / "node_modules"
            modules.mkdir()
            marker = modules / ".package-lock.json"
            marker.write_text("{}")
            lock = root / "package-lock.json"
            lock.write_text("{}")
            package = root / "package.json"
            package.write_text("{}")
            now = marker.stat().st_mtime + 100
            os.utime(marker, (now, now))
            self.assertFalse(install.node_dependencies_stale(root))
            newer = now + 10
            os.utime(lock, (newer, newer))
            self.assertTrue(install.node_dependencies_stale(root))
            os.utime(lock, (now - 10, now - 10))
            os.utime(package, (newer, newer))
            self.assertTrue(install.node_dependencies_stale(root))

    def test_main_builds_then_forwards_setup_arguments(self):
        with patch.object(install, "ensure_python"), \
                patch.object(install, "ensure_venv", return_value=Path("/venv/python")), \
                patch.object(install, "ensure_python_dependencies"), \
                patch.object(install, "ensure_node", return_value="npm"), \
                patch.object(install, "build_packages") as build, \
                patch.object(install.subprocess, "run", return_value=Mock(returncode=0)) as run, \
                patch("builtins.print"):
            code = install.main(["install", "--tv", "192.168.1.20", "--no-build"])
        self.assertEqual(code, 0)
        build.assert_not_called()
        run.assert_called_once()
        self.assertEqual(run.call_args.args[0],
                         ["/venv/python", str(install.SETUP), "install", "--tv", "192.168.1.20"])

    def test_main_builds_for_guided_setup(self):
        with patch.object(install, "ensure_python"), \
                patch.object(install, "ensure_venv", return_value=Path("/venv/python")), \
                patch.object(install, "ensure_python_dependencies"), \
                patch.object(install, "ensure_node", return_value="npm"), \
                patch.object(install, "build_packages") as build, \
                patch.object(install.subprocess, "run", return_value=Mock(returncode=0)), \
                patch("builtins.print"):
            code = install.main([])
        self.assertEqual(code, 0)
        build.assert_called_once_with("npm")

    def test_help_does_not_prepare_or_run_setup(self):
        with patch.object(install, "ensure_python") as ensure, patch("builtins.print") as output:
            self.assertEqual(install.main(["--help"]), 0)
        ensure.assert_not_called()
        self.assertIn("Prism installer", output.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
