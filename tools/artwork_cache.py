"""Read only app identity/art paths from Samsung's vd_applist output.

The mapping is generated per monitor at install time, never a maintained brand
registry. No account, certificates, pairing tokens or application data are read.
"""
import json
import re

FIELD = re.compile(r"^-+(app_tizen_id|app_panel_icon_path)\s*=([^\r\n]*?)-+$")
CACHE = re.compile(r"^/opt/share/webappservice/apps_icon/(?:all|FirstScreen)/[A-Za-z0-9_.-]+/$")
APP_ID = re.compile(r"^[A-Za-z0-9_.-]{1,160}$")


def artwork_map(applist: str) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    path = ""
    for line in applist.splitlines():
        if line and set(line.strip()) == {"-"}:
            path = ""
        match = FIELD.fullmatch(line.strip())
        if not match:
            continue
        field, value = match.groups()
        if field == "app_panel_icon_path":
            path = value if CACHE.fullmatch(value) and value.rstrip("/").split("/")[-1] not in {".", ".."} else ""
        elif path and APP_ID.fullmatch(value):
            result[value] = ["file://" + path + size for size in ["304x304.png", "250x250.png", "115x115.png"]]
    return result


def artwork_script(applist: str) -> str:
    return "// Generated from this monitor's installed-app metadata during setup.\nwindow.PRISM_ARTWORK=" + json.dumps(artwork_map(applist), separators=(",", ":")) + ";\n"
