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


def powershell_environment(engine, environment):
    # pwsh only repairs module paths when launching powershell.exe directly.
    # With Python in between, 5.1 inherits incompatible PowerShell 7 modules.
    # Let Windows PowerShell construct its own defaults, without changing ours.
    return {key: value for key, value in environment.items()
            if engine != "powershell" or key.upper() != "PSMODULEPATH"}


class PowerShellEnvironmentTests(unittest.TestCase):
    def test_windows_powershell_removes_inherited_module_paths_only(self):
        original = {"PSModulePath": "core modules", "psmodulepath": "other modules",
                    "PsMoDuLePaTh": "mixed case", "PATH": "commands", "FIXTURES": "with spaces"}
        before = original.copy()
        result = powershell_environment("powershell", original)
        self.assertEqual(result, {"PATH": "commands", "FIXTURES": "with spaces"})
        self.assertEqual(original, before)

    def test_pwsh_keeps_module_paths_in_a_separate_environment(self):
        original = {"PSModulePath": "core modules", "PATH": "commands"}
        result = powershell_environment("pwsh", original)
        self.assertEqual(result, original)
        result["PATH"] = "changed"
        self.assertEqual(original["PATH"], "commands")

    def test_missing_module_path_is_supported(self):
        self.assertEqual(powershell_environment("powershell", {"PATH": "commands"}),
                         {"PATH": "commands"})


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


class PowerShellBootstrapCases:
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.engines = {}
        for engine in ("pwsh", "powershell"):
            executable = shutil.which(engine)
            if executable is None:
                raise AssertionError(f"Required Windows bootstrap engine is missing: {engine}")
            cls.engines[engine] = executable
        # Obtain a real PS7 environment even when these tests start in cmd/5.1.
        probe = subprocess.run([cls.engines["pwsh"], "-NoProfile", "-NonInteractive", "-Command",
                                "[Console]::Write($env:PSModulePath)"],
                               env=powershell_environment("pwsh", os.environ),
                               capture_output=True, text=True, timeout=30)
        if probe.returncode or not probe.stdout.strip():
            raise AssertionError("Cannot obtain PowerShell 7 module paths: " + probe.stderr)
        cls.core_module_path = probe.stdout.strip()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="prism bootstrap spaces ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # The fixture executable is the already smoke-tested native Windows bundle.
        directory = ROOT / ".local/distribution/installers"
        metadata = directory / "windows-x64.json"
        self.assertTrue(metadata.is_file(), "Build the Windows installer first: missing windows-x64.json")
        self.row = json.loads(metadata.read_text())
        self.assertEqual(self.row["target"], "windows-x64")
        name = self.row["file"]
        self.assertEqual(name, f"prism-setup-windows-x64-{self.row['commit']}.zip")
        archive = directory / name
        self.assertTrue(archive.is_file(), "Missing Windows installer archive selected by windows-x64.json")
        self.fixture = self.root / "fixtures"
        self.fixture.mkdir()
        self.archive = self.fixture / name
        shutil.copyfile(archive, self.archive)
        self.write_manifest(self.row["sha256"])
        self.cache = self.root / "installer cache"
        self.destination = self.cache / ("windows-x64-" + self.row["commit"])
        self.state = self.root / "private state with spaces"
        device_state = self.state / hashlib.sha256(b"192.168.5.8").hexdigest()[:20]
        device_state.mkdir(parents=True)
        (device_state / "setup.json").write_text(json.dumps({"model": "fixture"}))
        self.sentinel = device_state / "original.json"
        self.sentinel.write_text("preserved")
        self.addCleanup(self.assert_preserved_and_clean)
        self.env = dict(os.environ, FIXTURES=str(self.fixture), BOOTSTRAP=str(ROOT / "scripts/install.ps1"),
                        PRISM_INSTALL_DIR=str(self.cache), FIXTURE_STATE=str(self.state))
        # Explicitly reproduce CI's pwsh -> Python -> powershell inheritance.
        for key in list(self.env):
            if key.upper() == "PSMODULEPATH":
                del self.env[key]
        self.env["PSModulePath"] = self.core_module_path

    def write_manifest(self, digest):
        (self.fixture / "downloads.txt").write_text(
            f"# prism-downloads-v1\nwindows-x64 {self.row['file']} {digest} {self.row['commit']} {self.row['version']}\n")

    def assert_preserved_and_clean(self):
        self.assertEqual(self.sentinel.read_text(), "preserved")
        self.assertEqual(list(self.cache.glob(".download.*")), [], "Temporary downloads were not cleaned up")

    def run_script(self, command="& $env:BOOTSTRAP --version"):
        script = self.root / "test.ps1"
        script.write_text('''$ErrorActionPreference = 'Stop'
function Invoke-WebRequest { param([switch]$UseBasicParsing, $Uri, $OutFile)
    Copy-Item -LiteralPath (Join-Path $env:FIXTURES ($Uri.Split('/')[-1])) -Destination $OutFile
}
try {
''' + command + '''
} catch {
    $failure = $_
    [Console]::Error.WriteLine(('Engine: {0} {1}; PSHOME: {2}' -f
        $PSVersionTable.PSEdition, $PSVersionTable.PSVersion, $PSHOME))
    foreach ($name in @('Get-FileHash', 'Expand-Archive')) {
        try {
            $resolved = Get-Command -Name $name -ErrorAction Stop
            [Console]::Error.WriteLine(('Command: {0}; module: {1}; path: {2}' -f
                $name, $resolved.Source, $resolved.Module.Path))
        } catch {
            [Console]::Error.WriteLine(('Command: {0}; unavailable: {1}' -f $name, $_))
        }
    }
    throw $failure
}
''')
        try:
            return subprocess.run([self.engines[self.engine], "-NoProfile", "-NonInteractive", "-File", str(script)],
                                  env=powershell_environment(self.engine, self.env),
                                  capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired as error:
            self.fail(f"{self.engine} timed out after 120s; stdout={error.stdout!r}; stderr={error.stderr!r}")

    def install_fixture(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Prism setup", result.stdout)
        self.assertIn(self.row["version"], result.stdout)
        self.assertTrue((self.destination / "prism-setup.exe").is_file())
        self.assert_preserved_and_clean()

    def test_engine_commands_resolve_with_inherited_core_module_paths(self):
        result = self.run_script('''foreach ($name in @('Get-FileHash', 'Expand-Archive')) {
    $resolved = Get-Command -Name $name -ErrorAction Stop
    [Console]::WriteLine($resolved.Name)
}''')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.splitlines(), ["Get-FileHash", "Expand-Archive"])
        self.assertFalse(self.cache.exists())

    def test_bad_checksum_never_extracts_or_executes(self):
        self.write_manifest("0" * 64)
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("checksum mismatch", result.stderr)
        self.assertNotIn("Prism setup", result.stdout)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_fresh_download(self):
        self.install_fixture()

    def test_cached_report_without_archive_preserves_arguments_and_state(self):
        self.install_fixture()
        self.archive.unlink()
        result = self.run_script('& $env:BOOTSTRAP report --tv 192.168.5.8 --state-dir $env:FIXTURE_STATE')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("fixture", result.stdout)
        self.assertNotIn("Downloading Prism", result.stdout)

    def test_damaged_cache_stops_before_report(self):
        self.install_fixture()
        helper = self.destination / "_internal/prism/native/PrismHome.dll"
        self.assertTrue(helper.is_file())
        helper.write_bytes(b"damaged helper fixture")
        self.archive.unlink()
        result = self.run_script('& $env:BOOTSTRAP report --tv 192.168.5.8 --state-dir $env:FIXTURE_STATE')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Cached installer is damaged", result.stderr)
        self.assertNotIn("# Prism device report draft", result.stdout)
        self.assertNotIn("Downloading Prism", result.stdout)


@unittest.skipUnless(os.name == "nt", "Windows bootstrap runs on the Windows packaging runner")
class PowerShell7BootstrapTests(PowerShellBootstrapCases, unittest.TestCase):
    engine = "pwsh"


@unittest.skipUnless(os.name == "nt", "Windows bootstrap runs on the Windows packaging runner")
class WindowsPowerShellBootstrapTests(PowerShellBootstrapCases, unittest.TestCase):
    engine = "powershell"


if __name__ == "__main__":
    unittest.main()
