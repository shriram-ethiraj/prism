"""Explicitly regenerate approved 4K masters; ordinary builds are fully offline.

Requires npm dependencies, and djxl / dpkg-deb only for originals using those
formats. Downloads are temporary unless --cache points to an external folder.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "assets/wallpapers/sources.json"
USER_AGENT = "PrismWallpaperSources/1.0 (https://github.com/shriram-ethiraj/prism)"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, destination, expected):
    if destination.exists():
        data = destination.read_bytes()
    else:
        chunks, size, started = [], 0, time.monotonic()
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        # A single request at a time, capped below Wikimedia's media bandwidth
        # limit. HTTP errors (including 429) stop the run; do not retry blindly.
        with urllib.request.urlopen(request, timeout=120) as response:
            while chunk := response.read(65536):
                size += len(chunk)
                if size > 300_000_000:
                    raise ValueError("Source exceeds the bounded download limit")
                chunks.append(chunk)
                time.sleep(max(0, size / (2.5 * 1024 * 1024) - (time.monotonic() - started)))
        data = b"".join(chunks)
    if digest(data) != expected:
        raise ValueError("Source checksum differs from the reviewed manifest")
    destination.write_bytes(data)
    return data


def regenerate(cache, only=None):
    rows = json.loads(SOURCES.read_text())
    if only:
        rows = [item for item in rows if item["selection_id"] in only]
        if {item["selection_id"] for item in rows} != set(only):
            raise ValueError("Unknown approved selection ID")
    for item in rows:
        original = item["original_source"]
        suffix = Path(urllib.parse.unquote(urllib.parse.urlsplit(item["download_url"]).path)).suffix
        source = cache / (item["original_sha256"] + suffix)
        if original.get("source_package"):
            if not shutil.which("dpkg-deb"):
                raise RuntimeError("Regenerating Ubuntu sources requires dpkg-deb")
            package = cache / original["source_package"]
            fetch(item["download_url"], package, original["source_package_sha256"])
            archive = subprocess.check_output(["dpkg-deb", "--fsys-tarfile", str(package)])
            with tarfile.open(fileobj=io.BytesIO(archive)) as contents:
                member = contents.getmember(original["source_package_member"])
                if not member.isfile() or member.size > 200_000_000:
                    raise ValueError("Invalid source package image")
                data = contents.extractfile(member).read()
            if digest(data) != item["original_sha256"]:
                raise ValueError("Package image differs from the reviewed manifest")
            source = cache / (item["original_sha256"] + Path(member.name).suffix)
            source.write_bytes(data)
        else:
            fetch(item["download_url"], source, item["original_sha256"])
        if source.suffix.lower() == ".jxl":
            if not shutil.which("djxl"):
                raise RuntimeError("Regenerating JPEG XL originals requires djxl")
            decoded = cache / (item["original_sha256"] + ".png")
            subprocess.run(["djxl", str(source), str(decoded)], check=True, capture_output=True)
            source = decoded
        output = ROOT / "assets/wallpapers" / item["file"]
        if not output.resolve().is_relative_to((ROOT / "assets/wallpapers/images").resolve()):
            raise ValueError("Invalid approved master destination")
        # Verify a temporary result before replacing a reviewed offline master.
        candidate = cache / (item["id"] + "-master.jpg")
        command = [
            "node", str(ROOT / "scripts/normalize-wallpaper.mjs"), str(source), str(candidate),
        ]
        if item.get("source_crop"):
            command.append(json.dumps(item["source_crop"]))
        result = subprocess.check_output(command, cwd=ROOT)
        size = json.loads(result)
        if size != {"width": item["source_width"], "height": item["source_height"]}:
            raise ValueError("Original source dimensions changed")
        if digest(candidate.read_bytes()) != item["master_sha256"]:
            raise ValueError("Regenerated master differs; review encoder versions before replacing")
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(candidate, output)
        print("Verified", item["selection_id"], item["title"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, help="Optional public-source cache outside the checkout")
    parser.add_argument("--only", nargs="+", help="Regenerate only these approved selection IDs, e.g. W247")
    args = parser.parse_args()
    if args.cache:
        cache = args.cache.resolve()
        if cache.is_relative_to(ROOT):
            parser.error("Source downloads must be cached outside the checkout")
        cache.mkdir(parents=True, exist_ok=True)
        regenerate(cache, args.only)
    else:
        with tempfile.TemporaryDirectory(prefix="prism-wallpaper-sources-") as directory:
            regenerate(Path(directory), args.only)


if __name__ == "__main__":
    main()
