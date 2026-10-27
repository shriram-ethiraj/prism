"""Standalone entry point; all device operations remain in the shared setup flow."""
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

import prism_runtime
import setup
from vendor.tizen.sdb import SdbError


def main(argv=None):
    arguments = sys.argv[1:] if argv is None else argv
    prism_runtime.configure_host_runtime()
    if arguments == ["--version"]:
        info = prism_runtime.build_info()
        print(f"Prism setup {info['version']} ({info['commit']})")
        return 0
    if arguments == ["--self-check"]:
        print(json.dumps(check_bundle(), sort_keys=True))
        return 0
    if prism_runtime.FROZEN and arguments not in (["--help"], ["-h"]):
        check_bundle()
    setup.main(arguments)
    return 0


def check_bundle():
    try:
        return prism_runtime.validate_bundle()
    except ValueError as error:
        # Self-check uses only public bundle resources and an ephemeral crypto key.
        raise setup.SetupError("Installer self-check failed: " + str(error)) from None
    except (OSError, KeyError, TypeError) as error:
        raise setup.SetupError("Installer self-check could not load its public resources (" + type(error).__name__ + "). Download a complete archive again.") from None


def entrypoint():
    try:
        return main()
    except (setup.SetupError, OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile,
            ET.ParseError, SdbError, subprocess.SubprocessError) as error:
        message = str(error) if isinstance(error, setup.SetupError) else type(error).__name__ + ": setup could not complete. Check the download, connectivity and setup guide; preserve the working installation and private recovery records."
        print(message, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Setup interrupted. Preserve recovery records; query live state before retrying writes.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(entrypoint())
