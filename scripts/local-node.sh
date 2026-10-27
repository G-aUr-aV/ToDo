#!/bin/sh
# Project-local Node for macOS/Linux. Installs the version pinned in .node-version into
# .tools/ (gitignored) and runs commands with it first on PATH. Global Node, nvm defaults
# and other projects are left alone.
#
#   scripts/local-node.sh install        install (or confirm) the pinned Node
#   scripts/local-node.sh npm start      run any command with the local Node
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tools="$root/.tools"
version=$(tr -d ' \t\r\nv' < "$root/.node-version")

fail() { printf 'local-node: %s\n' "$1" >&2; exit 1; }

case $(uname -s) in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "unsupported OS $(uname -s); install Node $version from https://nodejs.org instead." ;;
esac
case $(uname -m) in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) fail "unsupported CPU $(uname -m); install Node $version from https://nodejs.org instead." ;;
esac
# A shell translated by Rosetta reports x86_64 on Apple silicon; prefer the native build.
if [ "$os" = darwin ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then arch=arm64; fi

name="node-v$version-$os-$arch"
dir="$tools/$name"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

install_node() {
  [ -x "$dir/bin/node" ] && return
  command -v curl >/dev/null 2>&1 || fail "curl is required to download Node."
  mkdir -p "$tools"
  tmp=$(mktemp -d "$tools/.download.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT INT TERM
  base="https://nodejs.org/dist/v$version"
  printf 'Installing Node %s (%s-%s) into %s\n' "$version" "$os" "$arch" "$tools" >&2
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  curl -fL --progress-bar "$base/$name.tar.gz" -o "$tmp/$name.tar.gz"
  expected=$(awk -v file="$name.tar.gz" '$2 == file {print $1}' "$tmp/SHASUMS256.txt")
  [ -n "$expected" ] || fail "no published checksum for $name.tar.gz."
  [ "$(sha256 "$tmp/$name.tar.gz")" = "$expected" ] || fail "checksum mismatch for $name.tar.gz; nothing was installed."
  tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
  mv "$tmp/$name" "$dir"
  rm -rf "$tmp"
  trap - EXIT INT TERM
  # Drop builds for previously pinned versions or other architectures.
  for old in "$tools"/node-v*; do
    [ "$old" = "$dir" ] || rm -rf "$old"
  done
}

install_node
[ "$#" -gt 0 ] || set -- install

if [ "$1" = install ]; then
  printf 'Node %s at %s/bin/node\n' "$("$dir/bin/node" --version)" "$dir"
  exit 0
fi

PATH="$dir/bin:$PATH"
export PATH
exec "$@"
