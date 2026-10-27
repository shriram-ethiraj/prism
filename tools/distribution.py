"""Assemble public payloads and native host installers. Never signs a TV widget."""
import argparse
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import sysconfig
import tempfile

from prism_runtime import ROOT, HELPER_FILES

TARGETS = ("linux-x64", "macos-x64", "macos-arm64", "windows-x64")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def host_target():
    system = {"Linux": "linux", "Darwin": "macos", "Windows": "windows"}.get(platform.system())
    arch = {"x86_64": "x64", "AMD64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(platform.machine())
    target = f"{system}-{arch}"
    if target not in TARGETS:
        raise ValueError("Unsupported installer build host")
    return target


def prepare_payload(destination, helper, commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("A full source commit is required")
    destination.mkdir(parents=True, exist_ok=False)
    for name in ("package.json", "tizen/config.xml", "README.md", "AGENTS.md", "VERIFIED_DEVICES.md",
                 "LICENSE", "THIRD_PARTY_NOTICES.md", "public/fonts/OFL.txt",
                 "public/preview-icons/BRAND-ARTWORK-LICENSE.txt", "public/preview-icons/SOURCES.md",
                 "tools/vendor/tizen/LICENSE", "tools/vendor/tizen/provenance.json",
                 "assets/wallpapers/sources.json"):
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    for name in ("devices", "docs", "assets/wallpapers/licenses", "tools/vendor/tizen/ca"):
        shutil.copytree(ROOT / name, destination / name)
    version = json.loads((ROOT / "package.json").read_text())["version"]
    (destination / "packages").mkdir()
    for resolution in ("1080p", "2160p"):
        name = f"Prism-{version}-{resolution}-unsigned.wgt"
        shutil.copyfile(ROOT / "packages" / name, destination / "packages" / name)
    (destination / "native").mkdir()
    for name in HELPER_FILES:
        shutil.copyfile(helper / name, destination / "native" / name)
    info = {"schema": 1, "version": version, "commit": commit,
            "files": {str(path.relative_to(destination)).replace(os.sep, "/"): sha256(path)
                      for path in sorted(destination.rglob("*")) if path.is_file()}}
    (destination / "build-info.json").write_text(json.dumps(info, indent=2) + "\n")


def collect_licenses(destination):
    destination.mkdir()
    distributions = ["pyinstaller", "pyinstaller-hooks-contrib", "altgraph", "packaging", "setuptools",
                     "cryptography", "cffi", "pycparser", "certifi"]
    if sys.platform == "darwin":
        distributions.append("macholib")
    if sys.platform == "win32":
        distributions += ["pefile", "pywin32-ctypes"]
    for name in distributions:
        dist = metadata.distribution(name)
        matches = [entry for entry in (dist.files or [])
                   if entry.name.lower().startswith(("license", "copying", "notice"))]
        if not matches:
            raise ValueError(f"Missing distribution license: {name}")
        for index, entry in enumerate(matches):
            target = destination / f"{name}-{index}-{entry.name}"
            shutil.copyfile(dist.locate_file(entry), target)
    candidates = [Path(sysconfig.get_path("stdlib")) / "LICENSE.txt",
                  Path(sys.base_prefix) / "LICENSE.txt",
                  Path(sys.base_prefix) / "share/doc/python3.12/LICENSE"]
    license_path = next((path for path in candidates if path.is_file()), None)
    if not license_path:
        # Ubuntu's Python distribution puts the PSF notice here.
        license_path = Path("/usr/share/doc/python3.12/copyright")
    if not license_path.is_file():
        raise ValueError("Python runtime license could not be located")
    shutil.copyfile(license_path, destination / "Python-LICENSE.txt")


def collect_linux_library_notices(bundle):
    """Retain distro notices for the shared libraries PyInstaller redistributes."""
    if sys.platform != "linux":
        return
    families = {"libbz2": "libbz2-*", "libcrypto": "libssl3*", "libssl": "libssl3*",
                "libexpat": "libexpat1", "libffi": "libffi*", "libgcc_s": "libgcc-s1",
                "liblzma": "liblzma5", "libz": "zlib1g", "libuuid": "libuuid1",
                "libreadline": "libreadline*", "libtinfo": "libtinfo*", "libncursesw": "libncursesw*"}
    destination = bundle / "_internal/licenses/system"
    destination.mkdir()
    for library in (bundle / "_internal").glob("lib*.so*"):
        family = library.name.split(".so")[0]
        if family.startswith("libpython"):
            continue  # Python's runtime license was collected above.
        if family not in families:
            raise ValueError("Add a license notice for the bundled library family: " + family)
        notices = sorted(Path("/usr/share/doc").glob(families[family] + "/copyright"))
        if not notices:
            raise ValueError("Missing system library copyright notice: " + family)
        for notice in notices:
            shutil.copyfile(notice, destination / (notice.parent.name + "-copyright.txt"))
    # Debian/Ubuntu copyright notices refer to these full GNU license texts.
    shutil.copytree("/usr/share/common-licenses", destination / "common-licenses", symlinks=False)


def build_installer(payload, output, target):
    if target != host_target():
        raise ValueError("Installers must be built on their matching OS and architecture")
    info = json.loads((payload / "build-info.json").read_text())
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="prism-installer-build-") as temp:
        work = Path(temp)
        collect_licenses(work / "licenses")
        command = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--noupx",
                   "--name", "prism-setup", "--distpath", str(work / "dist"),
                   "--workpath", str(work / "work"), "--specpath", str(work),
                   "--paths", str(ROOT / "tools"),
                   "--add-data", f"{payload}{os.pathsep}prism",
                   "--add-data", f"{work / 'licenses'}{os.pathsep}licenses",
                   "--add-data", f"{payload / 'tools/vendor/tizen/ca'}{os.pathsep}vendor/tizen/ca",
                   "--hidden-import", "vendor.tizen.certs", "--hidden-import", "vendor.tizen.signer",
                   "--hidden-import", "native_runner", str(ROOT / "tools/installer_cli.py")]
        subprocess.run(command, check=True, env=dict(os.environ, PYINSTALLER_CONFIG_DIR=str(work / "cache")))
        bundle = work / "dist/prism-setup"
        collect_linux_library_notices(bundle)
        # Unpack and smoke-test exactly the archive that will be published.
        stem = f"prism-setup-{target}-{info['commit']}"
        kind = "zip" if target == "windows-x64" else "gztar"
        archive = Path(shutil.make_archive(str(output / stem), kind, bundle.parent, bundle.name))
        subprocess.run([sys.executable, str(ROOT / "tools/smoke_installer.py"), str(archive)], check=True)
        digest = sha256(archive)
        (output / (archive.name + ".sha256")).write_text(f"{digest}  {archive.name}\n")
        (output / (target + ".json")).write_text(json.dumps({"target": target, "file": archive.name,
                 "sha256": digest, "commit": info["commit"], "version": info["version"]}) + "\n")


def write_downloads(directory):
    rows = [json.loads((directory / (target + ".json")).read_text()) for target in TARGETS]
    if len({(row["version"], row["commit"]) for row in rows}) != 1:
        raise ValueError("Installer revisions do not match")
    lines = ["# prism-downloads-v1"]
    for target, row in zip(TARGETS, rows):
        suffix = ".zip" if target == "windows-x64" else ".tar.gz"
        if (row["target"] != target or not re.fullmatch(r"[a-f0-9]{40}", row["commit"]) or
                row["file"] != f"prism-setup-{target}-{row['commit']}{suffix}" or
                not re.fullmatch(r"\d+\.\d+\.\d+", row["version"]) or
                sha256(directory / row["file"]) != row["sha256"] or
                (directory / (row["file"] + ".sha256")).read_text() != f"{row['sha256']}  {row['file']}\n"):
            raise ValueError("Invalid installer metadata or checksum")
        lines.append(" ".join(str(row[key]) for key in ("target", "file", "sha256", "commit", "version")))
    (directory / "downloads.txt").write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    payload = commands.add_parser("payload")
    payload.add_argument("--output", type=Path, required=True)
    payload.add_argument("--helper-dir", type=Path, required=True)
    payload.add_argument("--commit", required=True)
    build = commands.add_parser("build")
    build.add_argument("--payload", type=Path, required=True)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--target", choices=TARGETS, required=True)
    manifest = commands.add_parser("manifest")
    manifest.add_argument("directory", type=Path)
    args = parser.parse_args()
    if args.command == "payload":
        prepare_payload(args.output.resolve(), args.helper_dir.resolve(), args.commit)
    elif args.command == "build":
        build_installer(args.payload.resolve(), args.output.resolve(), args.target)
    else:
        write_downloads(args.directory)


if __name__ == "__main__":
    main()
