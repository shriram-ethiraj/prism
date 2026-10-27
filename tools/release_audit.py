"""Read-only check of prospective public files; never stage or publish anything.

Checks file selection, common secret signatures, local paths, Markdown links and
ignore exceptions. This bounded scan complements review; it is not a guarantee
that every possible secret or third-party rights issue has been discovered.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def public_files():
    output = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT)
    return sorted(set(output.decode().strip("\0").split("\0")) - {""})


def audit():
    names = public_files()
    problems = []
    signatures = [r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
                  r"\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}", r"\bAKIA[0-9A-Z]{16}\b",
                  r"/(?:home|Users)/[^/\s]+/"]
    protected = {"experimentation", "node_modules", ".venv", "dist", "packages", "__pycache__", "obj", "bin", ".private", "private", "certificates"}
    sizes = []
    for name in names:
        path = ROOT / name
        if path.is_symlink():
            problems.append(f"Review symlink: {name}")
            continue
        if not path.is_file():
            continue
        if protected.intersection(path.relative_to(ROOT).parts) or name.startswith(("public/wallpapers/", "src/generated/")):
            problems.append(f"Generated/local material selected: {name}")
        if (path.suffix.lower() in {".p12", ".pfx", ".key", ".pem", ".wgt", ".token"} or
                path.name == "password.txt" or path.name.startswith(".env") or
                path.name.endswith(("-baseline.json", "-recovery.json"))):
            problems.append(f"Private artifact selected: {name}")
        size = path.stat().st_size
        sizes.append((size, name))
        if size > 10 * 1024 * 1024:
            problems.append(f"Review oversized file: {name}")
        try:
            text = path.read_text()
        except UnicodeError:
            continue
        if any(re.search(pattern, text) for pattern in signatures):
            problems.append(f"Review secret/local-path signature: {name}")
        if path.suffix == ".md":
            for target in re.findall(r"\]\(([^)]+)\)", text):
                target = target.split("#")[0].split(" \"")[0].strip("<>")
                if not target or re.match(r"[a-zA-Z]+:", target):
                    continue
                if not (path.parent / target).exists():
                    problems.append(f"Broken local Markdown link: {name} -> {target}")
    ignored = ["experimentation/draft.md", "public/wallpapers/example.jpg", "src/generated/wallpapers.ts",
               "certificates/author.p12", "private/password.txt", ".env", "packages/test.wgt",
               "tests/native/obj/test.json", "assets/wallpapers/custom/owner.jpg"]
    for name in ignored:
        if subprocess.run(["git", "check-ignore", "-q", "--no-index", name], cwd=ROOT).returncode != 0:
            problems.append(f"Ignore rule missing: {name}")
    required = ["assets/wallpapers/custom/README.md", *[str(p.relative_to(ROOT)) for p in (ROOT / "tools/vendor/tizen/ca").glob("*")]]
    for name in required:
        if name not in names:
            problems.append(f"Required public exception missing: {name}")
    provenance = json.loads((ROOT / "tools/vendor/tizen/provenance.json").read_text())
    import hashlib
    for entry in provenance["files"]:
        path = ROOT / "tools/vendor/tizen" / entry["path"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["vendored_sha256"]:
            problems.append(f"Vendored source hash changed: {entry['path']}")
    return {"files": len(names), "bytes": sum(x[0] for x in sizes),
            "top_level": dict(sorted(Counter(name.split('/')[0] for name in names).items())),
            "largest": [{"path": name, "bytes": size} for size, name in sorted(sizes, reverse=True)[:8]],
            "problems": problems}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = audit()
    print(json.dumps(result, indent=2) if args.json else
          f"Prospective public files: {result['files']}; {result['bytes'] / 1048576:.2f} MiB; findings: {len(result['problems'])}")
    if not args.json:
        for problem in result["problems"]: print(problem)
    raise SystemExit(bool(result["problems"]))
