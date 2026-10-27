"""Read-only resources shared by source setup and the standalone installer."""
import hashlib
import json
import os
from pathlib import Path
import sys

FROZEN = bool(getattr(sys, "frozen", False))
# Windows temp paths may use 8.3 aliases; containment checks compare resolved paths.
ROOT = (Path(sys._MEIPASS) / "prism").resolve() if FROZEN else Path(__file__).resolve().parent.parent
INSTALL_ROOT = Path(sys.executable).resolve().parent if FROZEN else ROOT
HELPER_FILES = ("PrismHome.dll", "PrismHome.deps.json", "PrismHome.runtimeconfig.json")


def configure_host_runtime():
    if not FROZEN:
        return
    import certifi
    import ssl
    import webbrowser
    # Official Python builds may name a certificate path absent on the end user's host.
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    if not ssl.create_default_context().get_ca_certs():
        raise ValueError("Installer HTTPS trust store is empty")
    original_open = webbrowser.open

    def open_host_browser(*args, **kwargs):
        # System browsers must not load PyInstaller's private shared libraries.
        saved = {name: os.environ.get(name) for name in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH")}
        try:
            for name in saved:
                value = os.environ.get(name + "_ORIG")
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value
            if sys.platform == "win32":
                import ctypes
                ctypes.windll.kernel32.SetDllDirectoryW(None)
            return original_open(*args, **kwargs)
        finally:
            for name, value in saved.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value
            if sys.platform == "win32":
                ctypes.windll.kernel32.SetDllDirectoryW(sys._MEIPASS)

    webbrowser.open = open_host_browser


def build_info():
    if not FROZEN:
        return {"version": json.loads((ROOT / "package.json").read_text())["version"], "commit": "source"}
    return json.loads((ROOT / "build-info.json").read_text())


def checked_resource(name):
    path = (ROOT / name).resolve()
    if not path.is_relative_to(ROOT.resolve()) or not path.is_file():
        raise ValueError("Installer resource is missing or outside its resource directory")
    return path


def validate_profile_resources(files):
    from device_registry import profiles
    records = profiles()
    if not records:
        raise ValueError("Installer has no device profiles")
    for record in records:
        names = [f"devices/{record['id']}.json",
                 *("devices/" + record[field] for field in ("evidence", "notes"))]
        if any(checked_resource(name).relative_to(ROOT).as_posix() not in files for name in names):
            raise ValueError("Installer device profile resources are missing from the integrity manifest")


def validate_bundle():
    """Offline integrity, widget identity, profiles, crypto and helper smoke check."""
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.serialization import pkcs12
    from vendor.tizen.certs import CA_DIR
    import zipfile
    import xml.etree.ElementTree as ET

    info = build_info()
    if not FROZEN:
        raise ValueError("--self-check requires a packaged installer")
    if info.get("schema") != 1 or not isinstance(info.get("files"), dict) or not info["files"]:
        raise ValueError("Invalid installer resource manifest")
    required = {"package.json", "tizen/config.xml",
                *("native/" + name for name in HELPER_FILES),
                *(f"packages/Prism-{info['version']}-{resolution}-unsigned.wgt"
                  for resolution in ("1080p", "2160p"))}
    if not required <= info["files"].keys():
        raise ValueError("Incomplete installer resource manifest")
    for name, digest in info["files"].items():
        if hashlib.sha256(checked_resource(name).read_bytes()).hexdigest() != digest:
            raise ValueError("Installer resource checksum failed")
    from setup import APP_ID, validate_wallpapers
    for resolution in ("1080p", "2160p"):
        profile = {"logical_surface": {"verified": True, "width": 3840, "height": 2160}} if resolution == "2160p" else None
        with zipfile.ZipFile(ROOT / f"packages/Prism-{info['version']}-{resolution}-unsigned.wgt") as widget:
            manifest = ET.fromstring(widget.read("config.xml"))
            app = manifest.find("{http://tizen.org/ns/widgets}application")
            if app is None or app.get("id") != APP_ID or manifest.get("version") != info["version"]:
                raise ValueError("Installer widget identity/version mismatch")
            if {"author-signature.xml", "signature1.xml"}.intersection(widget.namelist()):
                raise ValueError("Distribution widgets must be unsigned")
            validate_wallpapers(widget, profile)
    validate_profile_resources(info["files"])
    for name in ("vd_tizen_dev_author_ca.cer", "vd_tizen_dev_public2.crt"):
        data = (Path(CA_DIR) / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != info["files"]["tools/vendor/tizen/ca/" + name]:
            raise ValueError("Bundled public certificate authority checksum failed")
    # Exercise the same PKCS#12 backend used by signing, without owner credentials.
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    data = pkcs12.serialize_key_and_certificates(b"self-check", key, None, None, serialization.NoEncryption())
    restored, _, _ = pkcs12.load_key_and_certificates(data, None)
    if restored.public_key().public_numbers() != key.public_key().public_numbers():
        raise ValueError("Bundled signing backend failed")
    hashes.Hash(hashes.SHA256()).finalize()
    runtime = json.loads((ROOT / "native/PrismHome.runtimeconfig.json").read_text())
    if runtime["runtimeOptions"]["tfm"] != "netcoreapp3.1":
        raise ValueError("Unexpected native helper target runtime")
    return {"ok": True, "version": info["version"], "commit": info["commit"], "resources": len(info["files"])}
