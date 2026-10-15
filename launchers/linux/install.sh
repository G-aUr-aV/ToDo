#!/bin/sh
set -eu
command -v node >/dev/null 2>&1 || { printf '%s\n' 'Install Node 24 LTS first, then retry.' >&2; exit 1; }
exec node "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/install.mjs" "$@"
