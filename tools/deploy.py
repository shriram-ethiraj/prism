"""Compatibility entry point for Prism installation using in-repo setup code.

Existing --tv, --cert-dir and --launch flags use setup's install stage.
Native Home/startup assignment remains a separate setup stage.
"""
import sys
from setup import main, SetupError
from vendor.tizen.sdb import SdbError

if __name__ == '__main__':
    try:
        main(['install', *sys.argv[1:]])
    except (SetupError, OSError, ValueError, ImportError, SdbError) as error:
        raise SystemExit(str(error) if isinstance(error, SetupError) else
                         'Installation could not complete. Check docs/setup.md; preserve the working app.') from None
