#!/usr/bin/env python3
"""Prism installer driver: prepare the host, build packages, and run setup.

Run `python install.py` for guided setup, or forward any tools/setup.py stage
and its arguments, for example `python install.py doctor --tv 192.168.1.20`.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
SETUP = ROOT / "tools" / "setup.py"
REQUIREMENTS = ROOT / "requirements-setup.txt"
STAGES = {"guided", "discover", "doctor", "certificates", "install", "home", "verify", "restore", "report"}
BUILD_STAGES = {"guided", "install"}
MIN_PYTHON = (3, 10)
MIN_NODE = (22, 12, 0)
NO_BUILD = "--no-build"

HELP = """\
Prism installer

Usage:
  python install.py                 Guided setup (default)
  python install.py discover        List responding Samsung monitors
  python install.py doctor --tv <TV_IP>
  python install.py install --tv <TV_IP> --firmware <FULL_FIRMWARE> --launch
  python install.py <stage> [options]

Stages: guided, discover, doctor, certificates, install, home, verify, restore, report.
Arguments after the stage are passed to tools/setup.py.

The driver creates .venv, installs pinned host dependencies, and runs npm ci and
npm run build when the selected stage needs fresh packages. Add --no-build to
reuse packages that are already built during recovery.

Read docs/setup.md for the full device, certificate, and recovery procedure.
"""


class InstallerError(Exception):
    """Actionable installer failure without private setup data."""


def version_tuple(value):
    return tuple(int(part) for part in re.findall(r"\d+", value)) or (0,)


def version_at_least(value, minimum):
    current = version_tuple(value)
    width = max(len(current), len(minimum))
    return current + (0,) * (width - len(current)) >= minimum + (0,) * (width - len(minimum))


def stage_from(arguments):
    return arguments[0] if arguments and arguments[0] in STAGES else "guided"


def needs_build(stage, arguments):
    return stage in BUILD_STAGES and NO_BUILD not in arguments


def setup_arguments(arguments):
    return [argument for argument in arguments if argument != NO_BUILD]


def venv_python():
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def find_command(name):
    command = shutil.which(name)
    if not command:
        raise InstallerError(f"{name} was not found on PATH. Install the prerequisites in docs/setup.md and retry.")
    return command


def run(command):
    try:
        return subprocess.run(command, cwd=ROOT, check=True)
    except FileNotFoundError:
        raise InstallerError(f"Required command not found: {command[0]}") from None
    except subprocess.CalledProcessError as error:
        raise InstallerError(f"Command failed with exit code {error.returncode}. Read the output above and docs/setup.md.") from None


def ensure_python():
    if sys.version_info < MIN_PYTHON:
        raise InstallerError("Python 3.10 or newer is required. Install a current Python and rerun this command.")


def ensure_venv():
    python = venv_python()
    if python.is_file():
        return python
    print("Creating .venv...")
    run([sys.executable, "-m", "venv", str(VENV)])
    if not python.is_file():
        raise InstallerError("The virtual environment could not be created. Install the platform's python3-venv package and retry.")
    return python


def requirements_digest():
    return hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()


def ensure_python_dependencies(python):
    stamp = VENV / "prism-requirements.sha256"
    digest = requirements_digest()
    if stamp.is_file() and stamp.read_text().strip() == digest:
        return
    print("Installing host dependencies...")
    run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(REQUIREMENTS)])
    stamp.write_text(digest + "\n")


def ensure_node():
    node = find_command("node")
    npm = find_command("npm")
    try:
        output = subprocess.run([node, "--version"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        raise InstallerError("Node.js could not be executed. Reinstall Node.js 22.12 or newer and retry.") from None
    if not version_at_least(output, MIN_NODE):
        raise InstallerError(f"Node.js 22.12 or newer is required; found {output or 'unknown'}. Update Node.js and retry.")
    return npm


def node_dependencies_stale(root=ROOT):
    marker = root / "node_modules" / ".package-lock.json"
    if not marker.is_file():
        return True
    lock = root / "package-lock.json"
    package = root / "package.json"
    return any(source.is_file() and source.stat().st_mtime > marker.stat().st_mtime for source in (lock, package))


def ensure_node_dependencies(npm):
    if node_dependencies_stale():
        print("Installing Node dependencies...")
        run([npm, "ci"])
    else:
        print("Node dependencies are current.")


def build_packages(npm):
    ensure_node_dependencies(npm)
    print("Building Prism packages...")
    run([npm, "run", "build"])


def main(argv=None):
    arguments = list(sys.argv[1:] if argv is None else argv)
    if arguments in (["-h"], ["--help"]):
        print(HELP, end="")
        return 0
    stage = stage_from(arguments)
    print(f"Prism installer: {stage} stage")
    ensure_python()
    python = ensure_venv()
    ensure_python_dependencies(python)
    if needs_build(stage, arguments):
        build_packages(ensure_node())
    else:
        print("No package build is required for this stage.")
    forwarded = setup_arguments(arguments)
    if forwarded:
        print("Starting setup with: " + " ".join(forwarded))
    else:
        print("Starting guided setup...")
    completed = subprocess.run([str(python), str(SETUP), *forwarded], cwd=ROOT)
    return completed.returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except InstallerError as error:
        raise SystemExit(f"Installer error: {error}") from None
    except KeyboardInterrupt:
        raise SystemExit("Installer interrupted before setup completed.") from None
