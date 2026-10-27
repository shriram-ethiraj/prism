"""Prism setup: private state, explicit devices, and non-root native integration.

All transport/signing source is included in this repository. Run --help for stages.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

from artwork_cache import artwork_script
from device_registry import profiles, RESULTS
from vendor.tizen.sdb import Sdb, SdbError
from prism_runtime import ROOT, INSTALL_ROOT, FROZEN

if __name__ == "__main__":
    sys.modules["setup"] = sys.modules[__name__]

APP_ID = "Prizen0001.Home"
APP_PATTERN = re.compile(r"[A-Za-z0-9_.-]{1,160}")
FIELDS = re.compile(r"-{3,}([\w():,]+?)\s*=(.*?)-{5,}\s*$", re.M)


class SetupError(Exception):
    """Actionable setup failure, without raw credentials or device dumps."""


def external_path(value):
    path = Path(value).expanduser().resolve()
    if any(path == root or path.is_relative_to(root) for root in (ROOT.resolve(), INSTALL_ROOT.resolve())):
        raise SetupError("Private state and certificates must be outside the repository and installer directories (including symlink targets).")
    return path


def private_json(path, value):
    path = external_path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Atomic replacement avoids truncating a recovery baseline on interruption.
    fd, name = tempfile.mkstemp(prefix=".prism-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def safe_text(value):
    """Only accept public identity labels, never arbitrary REST fields in reports."""
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9 ._()/:+-]{1,100}", value):
        return "unknown"
    return value


def route_ip(tv):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
        route.connect((tv, 26101))
        return route.getsockname()[0]


def select_tv(value):
    if not value:
        if not sys.stdin.isatty():
            raise SetupError("Supply --tv <monitor LAN IP>. No device is selected automatically.")
        value = input("Monitor LAN IPv4 address (not the computer's address): ").strip()
    try:
        address = ipaddress.IPv4Address(value)
    except ipaddress.AddressValueError:
        raise SetupError("Use the monitor's numeric LAN IPv4 address.") from None
    private_lan = any(address in ipaddress.ip_network(network) for network in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
    if not private_lan:
        raise SetupError("Select a unicast monitor address on your private LAN.")
    return str(address)


def device_info(tv):
    try:
        # Direct LAN requests must not be sent to a host HTTP proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://{tv}:8001/api/v2/", timeout=5) as response:
            payload = response.read(65537)
        if len(payload) > 65536:
            raise ValueError("response too large")
        return json.loads(payload)["device"]
    except (OSError, ValueError, KeyError):
        raise SetupError("Cannot read monitor identity. Check it is awake, on the same LAN, and its IP is correct.") from None


def discover_devices(timeout=4):
    """Bounded LAN SSDP discovery; never select a device or alter its settings."""
    hosts = set()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
        sock.settimeout(0.5)
        for target in ("upnp:rootdevice", "urn:samsung.com:device:RemoteControlReceiver:1"):
            query = ('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ' + target + '\r\n\r\n').encode()
            sock.sendto(query, ("239.255.255.250", 1900))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and len(hosts) < 16:
            try:
                data, (host, _) = sock.recvfrom(8192)
                if re.search(rb"samsung|tizen", data, re.I):
                    hosts.add(select_tv(host))
            except socket.timeout:
                continue
            except SetupError:
                continue
    devices = []
    for host in sorted(hosts):
        try:
            info = device_info(host)
            devices.append({"ip": host, "model": safe_text(info.get("modelName")),
                            "developer_mode": str(info.get("developerMode")) == "1"})
        except SetupError:
            continue
    return devices


def match_profile(model, firmware):
    matches = [p for p in profiles() if p["model"] == model and p["firmware"] == firmware]
    return matches[0] if len(matches) == 1 else None


def installed_apps(text):
    apps = {}
    for block in re.split(r"\n-{20,}\s*\n", text):
        fields = {k.strip(): v.strip() for k, v in FIELDS.findall(block)}
        identity = fields.get("app_tizen_id") or fields.get("app_id", "")
        if APP_PATTERN.fullmatch(identity):
            apps[identity] = {"version": fields.get("app_version"), "name": fields.get("app_title", identity)}
    return apps


def verify_install(output, metadata, version):
    cleaned = re.sub(r"app_id\[[A-Za-z0-9_.-]+\]", "", output)
    if re.search(r"\b(fail(?:ed|ure)?|error|denied|cannot)\b|\bcan\s+not\b", cleaned, re.I):
        raise SetupError("Monitor rejected installation. Resolve certificate/author consistency; preserve the working app and do not uninstall it.")
    app = installed_apps(metadata).get(APP_ID)
    if not app or app["version"] != version:
        raise SetupError("Installed identity/version could not be verified. Installation is incomplete; do not configure Home.")


def foreground_status(tv, timeout=8):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with opener.open(f"http://{tv}:8001/api/v2/applications/{APP_ID}", timeout=2) as response:
                payload = response.read(16385)
            if len(payload) <= 16384:
                status = json.loads(payload)
                if status.get("running") is True and status.get("visible") is True:
                    return True
        except (OSError, ValueError, AttributeError):
            pass
        time.sleep(0.25)
    return False


def certificate_files(directory):
    directory = external_path(directory)
    required = ("author.p12", "distributor.p12", "password.txt", "device-profile.xml")
    if any(not (directory / name).is_file() for name in required):
        raise SetupError("Incomplete certificate directory. Run the certificates stage or supply all four files described in docs/setup.md.")
    # Also reject files symlinked into the checkout.
    for name in required:
        external_path(directory / name)
    return directory


def certificate_identity(directory, device_hash=None):
    from cryptography import x509
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.hazmat.primitives import hashes
    directory = certificate_files(directory)
    try:
        password = (directory / "password.txt").read_text().strip().encode()
        key, cert, _ = pkcs12.load_key_and_certificates((directory / "author.p12").read_bytes(), password)
        if key is None or cert is None:
            raise ValueError()
        dist_key, dist_cert, _ = pkcs12.load_key_and_certificates((directory / "distributor.p12").read_bytes(), password)
        if dist_key is None or dist_cert is None:
            raise ValueError()
        now = datetime.now(timezone.utc)
        for candidate in (cert, dist_cert):
            # Older system cryptography supports only naive UTC validity properties.
            if hasattr(candidate, "not_valid_after_utc"):
                starts, ends = candidate.not_valid_before_utc, candidate.not_valid_after_utc
            else:
                starts = candidate.not_valid_before.replace(tzinfo=timezone.utc)
                ends = candidate.not_valid_after.replace(tzinfo=timezone.utc)
            if not starts <= now < ends:
                raise SetupError("Signing certificate is expired or not yet valid. Preserve the author identity when renewing through Samsung's tools.")
        if device_hash:
            try:
                names = dist_cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
                duids = [uri.split("=", 1)[1] for uri in names.get_values_for_type(x509.UniformResourceIdentifier)
                         if uri.lower().startswith("urn:tizen:deviceid=")]
            except x509.ExtensionNotFound:
                duids = []
            if device_hash not in {hashlib.sha256(value.encode()).hexdigest() for value in duids}:
                raise SetupError("Distributor certificate does not identify this monitor. Obtain a matching device profile without changing the existing author identity.")
        return cert.fingerprint(hashes.SHA256()).hex()
    except (ValueError, TypeError):
        raise SetupError("Cannot unlock the signing certificates. Check their matching password locally; do not paste it into chat.") from None


def tool_path(connection):
    path = connection.capability().get("sdk_toolpath", "")
    if not re.fullmatch(r"/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+", path) or ".." in path.split("/"):
        raise SetupError("Monitor did not report a safe SDK staging directory; adapter review is required.")
    return path


def wallpaper_resolution(profile):
    """Panel resolution and unverified viewport values cannot select the 4K pack."""
    surface = (profile or {}).get("logical_surface", {})
    return "2160p" if (surface.get("verified") is True and
                       surface.get("width") == 3840 and surface.get("height") == 2160) else "1080p"


def widget_path(version, profile):
    return ROOT / "packages" / f"Prism-{version}-{wallpaper_resolution(profile)}-unsigned.wgt"


def validate_wallpapers(source, profile):
    """Validate explicit variant and content integrity before signing or installing."""
    try:
        manifest = json.loads(source.read("wallpapers/manifest.json"))
        resolution = wallpaper_resolution(profile)
        width, height = (3840, 2160) if resolution == "2160p" else (1920, 1080)
        if (manifest.get("schema") != 1 or manifest.get("resolution") != resolution or
                manifest.get("width") != width or manifest.get("height") != height or
                not isinstance(manifest.get("images"), list) or not manifest["images"]):
            raise ValueError()
        names = set()
        for image in manifest["images"]:
            filename = image["file"]
            if (not re.fullmatch(r"wallpapers/[a-z0-9-]+\.jpg", filename) or filename in names or
                    not isinstance(image.get("width"), int) or not isinstance(image.get("height"), int) or
                    not 0 < image["width"] <= width or not 0 < image["height"] <= height or
                    hashlib.sha256(source.read(filename)).hexdigest() != image["sha256"]):
                raise ValueError()
            names.add(filename)
            for suffix in ("-thumb.jpg", "-frost.jpg"):
                if not source.read(filename[:-4] + suffix):
                    raise ValueError()
    except (KeyError, TypeError, ValueError, zipfile.BadZipFile):
        raise SetupError("Wallpaper package is missing, damaged or does not match the selected logical surface. Rebuild before installation.") from None


def prepare_widget(unsigned, prepared, metadata, profile):
    with zipfile.ZipFile(unsigned) as source, zipfile.ZipFile(prepared, "w", zipfile.ZIP_DEFLATED) as target:
        manifest = ET.fromstring(source.read("config.xml"))
        app = manifest.find("{http://tizen.org/ns/widgets}application")
        version = json.loads((ROOT / "package.json").read_text())["version"]
        if app is None or app.get("id") != APP_ID or manifest.get("version") != version:
            raise SetupError("Widget identity/version does not match the project. Rebuild before installation.")
        validate_wallpapers(source, profile)
        for entry in source.infolist():
            if entry.filename not in {"device-artwork.js", "device-profile.js", "author-signature.xml", "signature1.xml"}:
                target.writestr(entry, source.read(entry.filename))
        target.writestr("device-artwork.js", artwork_script(metadata))
        surface = profile["logical_surface"] if profile else {"width": 1920, "height": 1080}
        target.writestr("device-profile.js", "window.PRISM_SURFACE=" + json.dumps({k: surface[k] for k in ("width", "height")}) + ";\n")
    return version


def owned_snapshot(snapshot):
    """Compare only settings Prism writes. Boot backup/first-screen are observations."""
    return {"home": snapshot["home"], "autostart": snapshot["autostart"],
            "strings": {key: snapshot["strings"][key]
                        for key in ("db/appfw/home_appid", "db/appfw/startup_appid")}}


def install(connection, directory, record, state, profile, launch=False):
    from vendor.tizen.signer import sign_wgt
    directory = certificate_files(directory)
    identity = certificate_identity(directory, record.get("device_hash"))
    if record.get("author_fingerprint") and record["author_fingerprint"] != identity:
        raise SetupError("Author certificate changed since this setup. Restore the original identity before updating; do not uninstall.")
    version = json.loads((ROOT / "package.json").read_text())["version"]
    unsigned = widget_path(version, profile)
    if not unsigned.is_file():
        raise SetupError("Download a complete installer again." if FROZEN else "Run npm ci and npm run build before installation.")
    metadata = connection.applist()
    path = tool_path(connection)
    with tempfile.TemporaryDirectory(prefix="prism-sign-", dir=state) as temp:
        prepared, signed = Path(temp) / "prepared.wgt", Path(temp) / "signed.wgt"
        prepare_widget(unsigned, prepared, metadata, profile)
        sign_wgt(prepared, signed, directory)
        connection.push((directory / "device-profile.xml").read_bytes(), path + "/device-profile.xml")
        # Author fingerprint is saved before the first write, including interrupted installations.
        record["author_fingerprint"] = identity
        record["installation"] = "pending"
        private_json(state / "setup.json", record)
        output = connection.install(APP_ID, signed.read_bytes(), path)
        verify_install(output, connection.applist(), version)
    record.update(installation="verified", prism_build=version, cert_dir=str(directory))
    private_json(state / "setup.json", record)
    if launch:
        connection.launch(APP_ID)
        if not foreground_status(connection.host):
            record["foreground_readback"] = "pending"
            private_json(state / "setup.json", record)
            raise SetupError("Installed version verified, but foreground launch could not be confirmed. Check the monitor before native Home changes.")
        record["foreground_readback"] = "verified"
        private_json(state / "setup.json", record)
    print("Prism identity and installed version verified. Home/startup require their separate stage.")


def native_stage(args, connection, record, state, profile, action):
    from native_runner import run_native
    if not profile or profile["native"]["adapter"] != "g70b-vconf":
        raise SetupError("No reviewed native adapter matches this exact device. Follow docs/setup.md#adapt-another-device; installation alone is incomplete.")
    if action not in {"query", "restore"} and not args.trial and profile["native"]["status"] != "verified":
        raise SetupError("This native profile is a candidate, not a verified setup. An authorized adaptation trial uses --trial after source/recovery review.")
    current = run_native(connection, args.tv, profile, "query", None, args.dotnet, args.helper_dir)
    record.update(firmware=current["firmware"], runtime=current["runtime"], architecture=current["architecture"], uid=current["uid"], privilege=f"SDK UID {current['uid']} (non-root)")
    original_path = state / "original.json"
    if action == "query":
        private_json(state / "setup.json", record)
        print(f"Native read-only query verified: {current['firmware']}; {current['runtime']}; UID {current['uid']}.")
        return
    if not original_path.exists():
        if action == "restore":
            raise SetupError("No original baseline exists for this device; no restoration attempted.")
        private_json(original_path, current["snapshot"])
    original = json.loads(original_path.read_text())
    planned_path = state / "planned.json"
    if action == "restore":
        expected = json.loads(planned_path.read_text()) if planned_path.exists() else original
        restored = run_native(connection, args.tv, profile, "restore", {"original": original, "expected": expected}, args.dotnet, args.helper_dir)
        if owned_snapshot(restored["snapshot"]) != owned_snapshot(original):
            raise SetupError("Restoration readback mismatch. Preserve all apps and private recovery files.")
        record["native_state"] = "restored-readback"
        private_json(state / "setup.json", record)
        print("Original settings restored and read back. Physical Home/recovery confirmation is still required.")
        return
    if record.get("installation") != "verified" or record.get("foreground_readback") != "verified" or installed_apps(connection.applist()).get(APP_ID, {}).get("version") != record.get("prism_build"):
        raise SetupError("Install Prism with --launch and verify its installed version and foreground launch before assigning Home.")
    desired = json.loads(json.dumps(original))
    desired["home"] = APP_ID
    desired["strings"]["db/appfw/home_appid"] = APP_ID
    desired["strings"]["db/appfw/startup_appid"] = APP_ID
    desired["autostart"] = 1
    if owned_snapshot(current["snapshot"]) == owned_snapshot(desired) and record.get("native_state") == "applied-readback":
        print("Prism Home/startup already match the saved desired state; no writes performed.")
        return
    if owned_snapshot(current["snapshot"]) != owned_snapshot(original):
        raise SetupError("Live state differs from the saved original. Restore/inspect the interrupted trial before applying again.")
    private_json(planned_path, desired)
    record["native_state"] = "pending"
    private_json(state / "setup.json", record)
    request = {"original": original, "expected": original}
    phase = "roundtrip"
    try:
        run_native(connection, args.tv, profile, "roundtrip", request, args.dotnet, args.helper_dir)
        # Exercise the recovery command against the original state before assignment.
        phase = "restore-preflight"
        run_native(connection, args.tv, profile, "restore", request, args.dotnet, args.helper_dir)
        phase = "home"
        after_home = run_native(connection, args.tv, profile, "home", request, args.dotnet, args.helper_dir)
        phase = "startup"
        after = run_native(connection, args.tv, profile, "startup", {"original": original, "expected": after_home["snapshot"]}, args.dotnet, args.helper_dir)
        if owned_snapshot(after["snapshot"]) != owned_snapshot(desired):
            raise SetupError("Final Home/startup readback mismatch.")
    except Exception as failure:
        reason = phase + ": " + (str(failure) if isinstance(failure, SetupError) else type(failure).__name__)
        record["native_failure"] = reason
        try:
            run_native(connection, args.tv, profile, "restore", {"original": original, "expected": desired}, args.dotnet, args.helper_dir)
            record["native_state"] = "restored-after-failure"
        except Exception:
            record["native_state"] = "recovery-required"
        private_json(state / "setup.json", record)
        raise SetupError("Native application failed: " + reason + ". Do not uninstall any launcher. Recovery status: " + record["native_state"]) from None
    record["native_state"] = "applied-readback"
    private_json(state / "setup.json", record)
    print("Prism Home and startup values read back correctly. Physical Home, standby, cold boot and full restore testing remain pending.")


def report(record):
    # Explicit allowlist: do not dump local state, identities, baselines or raw API fields.
    rows = ["# Prism device report draft", "", "Review and add physical observations before submitting. This tool does not post issues.", ""]
    for key in ("model", "firmware", "tizen", "web_engine", "architecture", "runtime", "privilege", "prism_build"):
        rows.append(f"- {key}: {safe_text(record.get(key))}")
    rows.append("- Date: " + datetime.now(timezone.utc).date().isoformat())
    rows.extend(["", "## Results", ""])
    for key in RESULTS:
        # Only installed metadata is automated. No physical success is inferred.
        result = "installed metadata verified; physical launch still needs observation" if key == "installation" and record.get("installation") == "verified" else "not yet confirmed"
        rows.append(f"- {key}: {result}")
    rows.extend(["", "Add tested apps/inputs, physical Home results, standby/cold-boot procedure, fullscreen/cropping observations, and restoration behavior. Remove private details from screenshots.", ""])
    return "\n".join(rows)


@contextmanager
def state_lock(state):
    state = external_path(state)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.chmod(0o700)
    path = state / "setup.lock"
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise SetupError("Another setup may be running. Resolve it before removing the private setup.lock file.") from None
    try:
        os.close(fd)
        yield
    finally:
        path.unlink(missing_ok=True)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("stage", nargs="?", default="guided", choices=("guided", "discover", "doctor", "certificates", "install", "home", "verify", "restore", "report"))
    result.add_argument("--tv", help="Explicit monitor LAN IPv4 address; never auto-selects the first device")
    result.add_argument("--firmware", help="Exact full firmware read from Settings > Support > About (confirmed by native helper before writes)")
    result.add_argument("--state-dir", type=Path, default=Path.home() / ".local/share/prism", help="Private state root outside this checkout")
    result.add_argument("--cert-dir", type=Path, help="Existing external private certificate directory")
    result.add_argument("--launch", action="store_true", help="Launch Prism after installation or during verify")
    result.add_argument("--trial", action="store_true", help="Run an already owner-authorized, reviewed candidate-profile trial")
    result.add_argument("--query", action="store_true", help="For home stage: query native settings without changing them")
    result.add_argument("--dotnet", default="dotnet", help="Host .NET SDK executable")
    result.add_argument("--helper-dir", type=Path, help="Use previously built helper files rather than building (external private cache)")
    return result


def main(argv=None):
    command_parser = parser()
    args = command_parser.parse_args(argv)
    if args.query and args.stage != "home":
        command_parser.error("--query is only valid for the home stage; no operation was performed")
    if args.stage == "discover":
        devices = discover_devices()
        for device in devices:
            print(json.dumps(device))
        print(f"Found {len(devices)} monitor(s). Select the intended address with --tv; no device was changed." if devices else
              "No Samsung monitor replied to discovery. It may still be connected; check Network Status/IP Settings and use --tv explicitly.")
        return
    args.tv = select_tv(args.tv)
    state_root = external_path(args.state_dir)
    # Per-address selector contains no public device information. A DUID hash below prevents wrong-device reuse.
    state = external_path(state_root / hashlib.sha256(args.tv.encode()).hexdigest()[:20])
    if args.stage == "report":
        path = state / "setup.json"
        if not path.exists():
            raise SetupError("No setup record for this address; run doctor first.")
        print(report(json.loads(path.read_text())))
        return
    if args.cert_dir:
        external_path(args.cert_dir)
    info = device_info(args.tv)
    if args.stage == "guided" and not args.firmware and sys.stdin.isatty():
        args.firmware = input("Full firmware string from Settings > Support > About: ").strip()
    host_ip = route_ip(args.tv)
    print(f"Host PC IP to enter in Developer Mode: {host_ip}")
    if str(info.get("developerMode")) != "1" or info.get("developerIP") != host_ip:
        raise SetupError("Enable Developer Mode with the Host PC IP shown above, restart the monitor, then retry. See docs/setup.md.")
    with state_lock(state), Sdb(args.tv, timeout=45).connect() as connection:
        duid = connection.duid()
        if not duid or "error" in duid.lower():
            raise SetupError("Cannot retrieve device identity; private recovery state cannot be bound safely.")
        duid_hash = hashlib.sha256(duid.encode()).hexdigest()
        stored = state / "setup.json"
        record = json.loads(stored.read_text()) if stored.exists() else {}
        if record.get("device_hash") not in {None, duid_hash}:
            raise SetupError("A different monitor now uses this address. Choose a new external --state-dir; never reuse its baseline.")
        caps = connection.capability()
        model = safe_text(info.get("modelName"))
        firmware = args.firmware or record.get("firmware") or "unknown"
        profile = match_profile(model, firmware)
        if record.get("model") not in {None, model} or (record.get("firmware") not in {None, "unknown", firmware} and (state / "original.json").exists()):
            raise SetupError("Device/firmware changed with an existing recovery record. Archive it externally and prepare a fresh profile/state root.")
        record.update(device_hash=duid_hash, model=model, firmware=firmware, last_checked=datetime.now(timezone.utc).isoformat())
        # Capability values remain observations, never inferred from a matched Tizen version.
        record["tizen"] = safe_text(caps.get("platform_version"))
        record["architecture"] = safe_text(caps.get("cpu_arch"))
        if profile:
            record["profile"] = profile["id"]
        private_json(stored, record)
        print(f"Device: {model}; firmware: {firmware}; matching profile: {profile['id'] if profile else 'none (adaptation required)'}")
        stage = args.stage
        if stage == "doctor":
            print("Developer connection verified. Firmware supplied from the screen is confirmed by the guarded native query before writes.")
            if FROZEN:
                print("Standalone installer: app packages, signing dependencies and native helper are bundled.")
            else:
                print("Host build tools: " + ", ".join(f"{name}={'available' if shutil.which(name) else 'missing'}" for name in ("node", "npm", args.dotnet)))
            return
        if stage in {"home", "restore"}:
            native_stage(args, connection, record, state, profile, "restore" if stage == "restore" else "query" if args.query else "apply")
            return
        if stage == "verify":
            version = json.loads((ROOT / "package.json").read_text())["version"]
            if installed_apps(connection.applist()).get(APP_ID, {}).get("version") != version:
                raise SetupError("Expected Prism installation was not found.")
            if args.launch:
                connection.launch(APP_ID)
                if not foreground_status(args.tv):
                    raise SetupError("Prism's foreground launch could not be confirmed; check the monitor.")
                record["foreground_readback"] = "verified"
                private_json(stored, record)
            print("Installed identity/version verified. Complete the physical checklist in docs/setup.md; no physical pass is inferred.")
            if profile:
                native_stage(args, connection, record, state, profile, "query")
            return
        directory = external_path(args.cert_dir or record.get("cert_dir") or state / "certificates")
        if stage == "certificates" or (stage == "guided" and not (directory / "author.p12").exists()):
            if any(directory.glob("*")):
                raise SetupError("Certificate directory already has files. Reuse the complete existing profile; this command never overwrites signing material.")
            if APP_ID in installed_apps(connection.applist()):
                raise SetupError("Prism is already installed. Supply its existing --cert-dir rather than creating a different author identity.")
            from vendor.tizen.certs import create_profile
            print("Complete Samsung sign-in in your own browser. Credentials stay on this computer.")
            create_profile(duid, str(directory))
            for file in directory.iterdir():
                if file.is_file():
                    file.chmod(0o600)
            record["cert_dir"] = str(directory)
            private_json(stored, record)
            if stage == "certificates":
                print("Private certificate profile created; keep it for future updates.")
                return
        install(connection, directory, record, state, profile, args.launch or stage == "guided")
        if stage == "guided":
            native_stage(args, connection, record, state, profile, "apply")
            print("Follow docs/setup.md's physical acceptance and restore/reapply checklist. Generate a reviewed report with the report stage.")


if __name__ == "__main__":
    try:
        main()
    except ImportError:
        raise SystemExit("Install requirements-setup.txt in .venv and use .venv's Python for setup. No external launcher package is required.") from None
    except (SetupError, OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile, ET.ParseError, SdbError, subprocess.SubprocessError) as error:
        # Exceptions from underlying transport/crypto must not expose private dumps.
        message = str(error) if isinstance(error, SetupError) else f"{type(error).__name__}: setup could not complete. Check dependencies/connectivity and docs/setup.md; preserve the working installation."
        raise SystemExit(message) from None
