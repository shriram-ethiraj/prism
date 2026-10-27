"""CI-only rolling prerelease publication. Run only after all checks succeed."""
import argparse
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile

from distribution import TARGETS, write_downloads

REPO = "shriram-ethiraj/prism"
TAG = "main-build"


def gh(*arguments):
    return subprocess.check_output(["gh", *arguments], text=True)


def already_promoted(release, commit, version):
    manifest = next((asset for asset in release.get("assets", []) if asset["name"] == "downloads.txt"), None)
    if manifest is None:
        return False
    lines = gh("api", f"repos/{REPO}/releases/assets/{manifest['id']}",
               "--header", "Accept: application/octet-stream").splitlines()
    if len(lines) != 5 or lines[0] != "# prism-downloads-v1":
        return False
    for target, line in zip(TARGETS, lines[1:]):
        fields = line.split(" ")
        suffix = ".zip" if target == "windows-x64" else ".tar.gz"
        if (len(fields) != 5 or fields[0] != target or fields[1] != f"prism-setup-{target}-{commit}{suffix}" or
                not re.fullmatch(r"[a-f0-9]{64}", fields[2]) or fields[3:] != [commit, version]):
            return False
    return True


def publish(directory, commit):
    if (os.environ.get("GITHUB_REPOSITORY") != REPO or os.environ.get("GITHUB_EVENT_NAME") != "push" or
            os.environ.get("GITHUB_REF") != "refs/heads/main" or os.environ.get("GITHUB_SHA") != commit):
        raise ValueError("Publication is restricted to verified main pushes in the upstream repository")
    write_downloads(directory)
    rows = [json.loads((directory / (target + ".json")).read_text()) for target in TARGETS]
    if any(row["commit"] != commit for row in rows):
        raise ValueError("Installer artifacts do not match this workflow revision")
    if gh("api", f"repos/{REPO}/git/ref/heads/main", "--jq", ".object.sha").strip() != commit:
        print("A newer main revision exists; this run will not publish.")
        return
    releases = json.loads(gh("api", f"repos/{REPO}/releases", "--paginate", "--slurp"))
    release = next((item for page in releases for item in page if item["tag_name"] == TAG), None)
    if release and already_promoted(release, commit, rows[0]["version"]):
        # Rebuilding the same source can change archive timestamps/checksums.
        # Keep the existing promoted bytes usable instead of replacing them in place.
        print("This main revision is already promoted; its existing downloads are retained.")
        return
    with tempfile.TemporaryDirectory(prefix="prism-release-notes-") as temp:
        notes = Path(temp) / "notes.md"
        notes.write_text(f"Automated main prerelease: `{commit}` (Prism {rows[0]['version']}).\n\n"
                         "Use the one-command installer in the README, or download the archive for your computer. "
                         "Python and setup dependencies are bundled. Developer Mode and your own Samsung signing "
                         "identity are still required. Device compatibility and physical Home/startup checks are separate.\n\n"
                         f"[Source and instructions](https://github.com/{REPO}/tree/{commit})\n")
        if release is None:
            gh("release", "create", TAG, "--repo", REPO, "--target", commit, "--prerelease",
               "--latest=false", "--title", "Prism — latest main build", "--notes-file", str(notes))
        elif not release["prerelease"] or release["draft"]:
            raise ValueError("The main-build release must be a published prerelease")
        # Commit-qualified filenames keep an existing manifest usable during upload.
        files = [str(directory / (row["file"] + suffix)) for row in rows for suffix in ("", ".sha256")]
        gh("release", "upload", TAG, *files, "--repo", REPO, "--clobber")
        # Recheck immediately before promotion, inside the workflow's publication lock.
        if gh("api", f"repos/{REPO}/git/ref/heads/main", "--jq", ".object.sha").strip() != commit:
            print("Main advanced during upload; the previous download manifest is retained.")
            return
        gh("api", "--method", "PATCH", f"repos/{REPO}/git/refs/tags/{TAG}", "-f", f"sha={commit}", "-F", "force=true")
        gh("release", "edit", TAG, "--repo", REPO, "--prerelease", "--latest=false", "--notes-file", str(notes))
        gh("release", "upload", TAG, str(directory / "downloads.txt"), "--repo", REPO, "--clobber")
    print("Published all four checked installers and promoted downloads.txt.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    publish(args.directory, args.commit)
