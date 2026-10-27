"""Exercise the distributed archive with an empty PATH and no TV connection."""
import json
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def smoke(archive):
    with tempfile.TemporaryDirectory(prefix="prism smoke with spaces ") as temp:
        root = Path(temp)
        shutil.unpack_archive(str(archive), str(root / "unpacked"))
        executable = root / "unpacked/prism-setup" / ("prism-setup.exe" if os.name == "nt" else "prism-setup")
        env = dict(os.environ, PATH=str(root / "no developer tools"), PYTHONPATH="", PYTHONHOME="")
        result = subprocess.run([str(executable), "--self-check"], env=env, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError("Offline installer self-check failed: " + result.stderr)
        if not json.loads(result.stdout).get("ok"):
            raise ValueError("Installer self-check failed")
        subprocess.run([str(executable), "--version"], env=env, check=True)
        subprocess.run([str(executable), "--help"], env=env, check=True, stdout=subprocess.DEVNULL)
        state = root / "private state with spaces"
        directory = state / hashlib.sha256(b"192.168.5.8").hexdigest()[:20]
        directory.mkdir(parents=True)
        (directory / "setup.json").write_text(json.dumps({"model": "SmokeFixture"}))
        (directory / "original.json").write_text("preserved baseline fixture")
        report = subprocess.run([str(executable), "report", "--tv", "192.168.5.8", "--state-dir", str(state)],
                                env=env, check=True, capture_output=True, text=True)
        if "SmokeFixture" not in report.stdout or (directory / "original.json").read_text() != "preserved baseline fixture":
            raise ValueError("Offline argument forwarding/private-state check failed")
        forbidden = executable.parent / "private"
        refused = subprocess.run([str(executable), "report", "--tv", "192.168.5.8", "--state-dir", str(forbidden)],
                                 env=env, capture_output=True, text=True)
        if refused.returncode == 0 or forbidden.exists():
            raise ValueError("Installer accepted private state inside the bundle")
        # Corruption must fail before any device connection or signing operation.
        (executable.parent / "_internal/prism/native/PrismHome.dll").write_bytes(b"damaged helper fixture")
        damaged = subprocess.run([str(executable), "--self-check"], env=env, capture_output=True, text=True)
        if damaged.returncode == 0 or "checksum failed" not in damaged.stderr:
            raise ValueError("Installer accepted a corrupted native helper")
        print("Standalone archive passed offline integrity, crypto, arguments and private-state checks without developer tools on PATH.")


if __name__ == "__main__":
    smoke(Path(sys.argv[1]).resolve())
