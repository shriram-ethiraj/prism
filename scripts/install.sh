#!/bin/sh
# Download a verified standalone Prism installer; no developer tools or sudo.
set -eu

fail() { printf '%s\n' "Prism: $*" >&2; exit 1; }
system=$(uname -s)
arch=$(uname -m)
case "$system:$arch" in
    Linux:x86_64) target=linux-x64 ;;
    Darwin:x86_64) target=macos-x64 ;;
    Darwin:arm64) target=macos-arm64 ;;
    *) fail "Unsupported host $system/$arch. Downloads support Linux x64, macOS Intel/Apple Silicon, and Windows x64 (PowerShell)." ;;
esac
for tool in curl awk tar mktemp; do
    command -v "$tool" >/dev/null 2>&1 || fail "Required system tool not found: $tool"
done
if command -v sha256sum >/dev/null 2>&1; then
    checksum() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
    checksum() { shasum -a 256 "$1" | awk '{print $1}'; }
else
    fail "A SHA-256 tool (sha256sum or shasum) is required."
fi

base=https://github.com/shriram-ethiraj/prism/releases/download/main-build
root=${PRISM_INSTALL_DIR:-"$HOME/.local/share/prism/installers"}
[ ! -L "$root" ] || fail "Installer directory must not be a symbolic link."
mkdir -p "$root"
root=$(cd "$root" && pwd -P)
work=$(mktemp -d "$root/.download.XXXXXXXX")
lock=
cleanup() {
    rm -rf "$work"
    if [ -n "$lock" ]; then rmdir "$lock"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
curl -fLsS --retry 3 "$base/downloads.txt" -o "$work/downloads.txt" || fail "No successful main build is available, or GitHub could not be reached."
[ "$(head -n 1 "$work/downloads.txt")" = '# prism-downloads-v1' ] || fail "Unsupported download manifest."
row=$(awk -v target="$target" '$1 == target {print; count++} END {if (count != 1) exit 1}' "$work/downloads.txt") || fail "Download manifest has no unique entry for this host."
# Manifest fields contain only the checked tokens below; never evaluate manifest text.
set -f
old_ifs=$IFS
IFS=' '
# Preserve the caller's arguments before parsing the row in a separate function.
parse_row() {
    [ "$#" -eq 5 ] || fail "Invalid download manifest row."
    asset=$2 digest=$3 commit=$4 version=$5
}
parse_row $row
IFS=$old_ifs
case "$commit" in *[!0-9a-f]*|'') fail "Invalid source revision." ;; esac
[ "${#commit}" -eq 40 ] || fail "Invalid source revision."
case "$digest" in *[!0-9a-f]*|'') fail "Invalid download checksum." ;; esac
[ "${#digest}" -eq 64 ] || fail "Invalid download checksum."
[ "$asset" = "prism-setup-$target-$commit.tar.gz" ] || fail "Invalid download filename."
printf '%s\n' "$version" | awk '/^[0-9]+\.[0-9]+\.[0-9]+$/ {valid=1} END {exit !valid}' || fail "Invalid build version."
destination="$root/$target-$commit"
[ ! -L "$destination" ] || fail "Cached installer must not be a symbolic link."
cache_lock="$root/.$target-$commit.lock"
mkdir "$cache_lock" 2>/dev/null || fail "Another download is in progress. If it was interrupted, remove $cache_lock and retry."
lock=$cache_lock
if [ ! -e "$destination" ]; then
    printf 'Downloading Prism %s for %s...\n' "$version" "$target"
    curl -fLsS --retry 3 "$base/$asset" -o "$work/installer.tar.gz" || fail "Installer download failed."
    [ "$(checksum "$work/installer.tar.gz")" = "$digest" ] || fail "Download checksum mismatch. Nothing was run; retry the command."
    # Only our fixed top-level directory and relative entries may be extracted.
    tar -tzf "$work/installer.tar.gz" > "$work/entries"
    awk '/^\// || /(^|\/)\.\.($|\/)/ || ($0 !~ /^prism-setup(\/|$)/) {exit 1}' "$work/entries" || fail "Unsafe installer archive paths."
    mkdir "$work/unpacked"
    tar -xzf "$work/installer.tar.gz" -C "$work/unpacked"
    "$work/unpacked/prism-setup/prism-setup" --self-check || fail "Installer failed its offline check."
    mv "$work/unpacked/prism-setup" "$destination"
fi
executable="$destination/prism-setup"
[ -x "$executable" ] || fail "Incomplete cached installer. Remove $destination and retry."
"$executable" --self-check || fail "Cached installer is damaged. Remove $destination and retry."
rmdir "$lock"
lock=
printf 'Installer: %s\n' "$executable"
# curl | sh consumes stdin. Reopen the terminal for the existing guided prompts.
if [ "$#" -eq 0 ] || [ "${1:-}" = guided ]; then
    [ -r /dev/tty ] || fail "Guided setup needs a terminal. Download the installer and run it in a terminal."
    "$executable" "$@" </dev/tty
else
    "$executable" "$@"
fi
