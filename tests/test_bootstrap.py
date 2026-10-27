"""Run real bootstraps against fixture downloads, without contacting GitHub or a TV."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
COMMIT = "c" * 40


@unittest.skipIf(os.name == "nt", "POSIX bootstrap; Windows tests use PowerShell below")
class ShellBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="prism bootstrap with spaces ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "commands"
        self.bin.mkdir()
        self.downloads = self.root / "downloads"
        self.downloads.mkdir()
        self.log = self.root / "calls"
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                        PRISM_INSTALL_DIR=str(self.root / "installed versions"), FIXTURES=str(self.downloads),
                        CALL_LOG=str(self.log), MOCK_ARCH="x86_64", MOCK_OS="Linux")
        self.command("uname", '#!/bin/sh\ncase "$1" in -s) echo "$MOCK_OS";; -m) echo "$MOCK_ARCH";; esac\n')
        self.command("curl", f'#!{sys.executable}\nimport os,shutil,sys\nfrom pathlib import Path\na=sys.argv\nurl=next(v for v in a if v.startswith("https://"))\nshutil.copyfile(Path(os.environ["FIXTURES"])/url.rsplit("/",1)[1],a[a.index("-o")+1])\n')

    def command(self, name, text):
        path = self.bin / name
        path.write_text(text)
        path.chmod(0o755)

    def fixture(self, target="linux-x64", digest=None, member="prism-setup/prism-setup"):
        name = f"prism-setup-{target}-{COMMIT}.tar.gz"
        payload = b'#!/bin/sh\n[ "${1:-}" = --self-check ] && exit 0\nif [ "$#" -eq 0 ]; then IFS= read -r response; printf "%s\\n" "$response" >> "$CALL_LOG"; else printf "%s\\n" "$@" >> "$CALL_LOG"; fi\n'
        with tarfile.open(self.downloads / name, "w:gz") as archive:
            entry = tarfile.TarInfo(member)
            entry.mode = 0o755
            entry.size = len(payload)
            archive.addfile(entry, io.BytesIO(payload))
        checksum = digest or hashlib.sha256((self.downloads / name).read_bytes()).hexdigest()
        (self.downloads / "downloads.txt").write_text(f"# prism-downloads-v1\n{target} {name} {checksum} {COMMIT} 0.2.10\n")

    def run_bootstrap(self, *args):
        return subprocess.run(["sh", str(ROOT / "scripts/install.sh"), *args], env=self.env, text=True, capture_output=True)

    def test_forwards_arguments_with_spaces_and_preserves_state_across_downloads(self):
        self.fixture()
        private = self.root / "private certificates"
        private.mkdir()
        (private / "original.json").write_text("keep")
        result = self.run_bootstrap("restore", "--state-dir", str(private))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.log.read_text().splitlines(), ["restore", "--state-dir", str(private)])
        # Cached version works even if the archive is no longer present.
        next(self.downloads.glob("*.tar.gz")).unlink()
        result = self.run_bootstrap("--version")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((private / "original.json").read_text(), "keep")

    def test_macos_architecture_selection(self):
        for arch, target in (("arm64", "macos-arm64"), ("x86_64", "macos-x64")):
            self.env.update(MOCK_OS="Darwin", MOCK_ARCH=arch)
            self.fixture(target=target)
            result = self.run_bootstrap("--version")
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_unsupported_architecture_stops_before_downloading(self):
        self.env["MOCK_ARCH"] = "aarch64"
        result = self.run_bootstrap("--version")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unsupported host", result.stderr)
        self.assertFalse(self.log.exists())

    def test_bad_checksum_never_executes(self):
        self.fixture(digest="0" * 64)
        result = self.run_bootstrap("--version")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("checksum mismatch", result.stderr)
        self.assertFalse(self.log.exists())

    def test_unsafe_archive_paths_never_execute(self):
        self.fixture(member="../escaped")
        result = self.run_bootstrap("--version")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "escaped").exists())
        self.assertFalse(self.log.exists())

    def test_duplicate_manifest_target_is_rejected(self):
        self.fixture()
        path = self.downloads / "downloads.txt"
        path.write_text(path.read_text() + path.read_text().splitlines()[1] + "\n")
        result = self.run_bootstrap("--version")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unique entry", result.stderr)

    def test_piped_script_preserves_interactive_terminal_input(self):
        import pty
        import select
        import time
        self.fixture()
        env = dict(self.env, BOOTSTRAP=str(ROOT / "scripts/install.sh"))
        pid, terminal = pty.fork()
        if pid == 0:
            os.execvpe("sh", ["sh", "-c", 'cat "$BOOTSTRAP" | sh'], env)
        try:
            os.write(terminal, b"owner-response\n")
            deadline = time.monotonic() + 10
            output = bytearray()
            while time.monotonic() < deadline:
                ready, _, _ = select.select([terminal], [], [], 0.1)
                if ready:
                    try:
                        chunk = os.read(terminal, 4096)
                    except OSError:
                        break
                    if not chunk:
                        break
                    output.extend(chunk)
            done, status = os.waitpid(pid, os.WNOHANG)
            if done == 0:
                os.kill(pid, 9)
                os.waitpid(pid, 0)
                self.fail("Piped installer did not finish reading terminal input")
            self.assertEqual(os.waitstatus_to_exitcode(status), 0, output.decode())
            self.assertEqual(self.log.read_text(), "owner-response\n")
        finally:
            os.close(terminal)


@unittest.skipUnless(os.name == "nt", "Windows bootstrap runs on the Windows packaging runner")
class PowerShellBootstrapTests(unittest.TestCase):
    def test_bootstrap_against_local_fixture_and_checksum_failure(self):
        # The fixture executable is the already smoke-tested native Windows bundle.
        archives = list((ROOT / ".local/distribution/installers").glob("*.zip"))
        if not archives:
            self.skipTest("Build the Windows installer first")
        with tempfile.TemporaryDirectory(prefix="prism bootstrap spaces ") as temp:
            root = Path(temp)
            archive = archives[0]
            row = json.loads((archive.parent / "windows-x64.json").read_text())
            fixture = root / "fixtures"
            fixture.mkdir()
            shutil.copyfile(archive, fixture / archive.name)
            manifest = fixture / "downloads.txt"
            def write_manifest(digest):
                manifest.write_text(f"# prism-downloads-v1\nwindows-x64 {archive.name} {digest} {row['commit']} {row['version']}\n")
            script = root / "test.ps1"
            script.write_text('''$ErrorActionPreference = 'Stop'
function Invoke-WebRequest { param($UseBasicParsing, $Uri, $OutFile)
    Copy-Item -LiteralPath (Join-Path $env:FIXTURES ($Uri.Split('/')[-1])) -Destination $OutFile
}
& $env:BOOTSTRAP --version
'''.replace('param($UseBasicParsing,', 'param([switch]$UseBasicParsing,'))
            env = dict(os.environ, FIXTURES=str(fixture), BOOTSTRAP=str(ROOT / "scripts/install.ps1"),
                       PRISM_INSTALL_DIR=str(root / "installer cache"))
            def run_script(engine):
                engine_env = dict(env, PRISM_INSTALL_DIR=str(root / (engine + " installer cache")))
                return subprocess.run([engine, "-NoProfile", "-File", str(script)], env=engine_env, capture_output=True, text=True)
            write_manifest("0" * 64)
            for engine in ("pwsh", "powershell"):
                with self.subTest(engine=engine, scenario="bad checksum"):
                    bad = run_script(engine)
                    self.assertNotEqual(bad.returncode, 0)
                    self.assertIn("checksum mismatch", bad.stderr)
            write_manifest(row["sha256"])
            for engine in ("pwsh", "powershell"):
                with self.subTest(engine=engine, scenario="download"):
                    good = run_script(engine)
                    self.assertEqual(good.returncode, 0, good.stderr)
                    self.assertIn("Prism setup", good.stdout)
            state = root / "private state with spaces"
            device_state = state / hashlib.sha256(b"192.168.5.8").hexdigest()[:20]
            device_state.mkdir(parents=True)
            (device_state / "setup.json").write_text(json.dumps({"model": "fixture"}))
            (device_state / "original.json").write_text("preserved")
            env["FIXTURE_STATE"] = str(state)
            script.write_text(script.read_text().replace('& $env:BOOTSTRAP --version',
                '& $env:BOOTSTRAP report --tv 192.168.5.8 --state-dir $env:FIXTURE_STATE'))
            for engine in ("pwsh", "powershell"):
                with self.subTest(engine=engine, scenario="cached report with arguments"):
                    report = run_script(engine)
                    self.assertEqual(report.returncode, 0, report.stderr)
                    self.assertIn("fixture", report.stdout)
            self.assertEqual((device_state / "original.json").read_text(), "preserved")


if __name__ == "__main__":
    unittest.main()
