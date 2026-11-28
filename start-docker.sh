#!/bin/sh
# First-run helper for Docker Compose. Existing private state and .env are retained.
set -eu
workspace=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$workspace"
command -v docker >/dev/null 2>&1 || { echo "Install Docker with Compose, then run this command again." >&2; exit 1; }
docker compose version >/dev/null
if [ ! -e .env ]; then
  (
    umask 077
    set -C
    printf '# Local Docker owner IDs. Other settings are documented in .env.example.\nTODO_UID=%s\nTODO_GID=%s\n' "$(id -u)" "$(id -g)" > .env
  )
fi
vault='./Todo Vault'
state='./.todo-state/server'
port=${TODO_PORT:-4310}
public_origin=${TODO_PUBLIC_ORIGIN:-}
settings=$(docker compose config --environment)
while IFS='=' read -r key value; do
  case "$key" in
    TODO_VAULT_PATH) vault=$value ;;
    TODO_STATE_PATH) state=$value ;;
    TODO_PORT) port=$value ;;
    TODO_PUBLIC_ORIGIN) public_origin=$value ;;
  esac
done <<EOF_SETTINGS
$settings
EOF_SETTINGS
[ -n "$vault" ] && [ -n "$state" ] || { echo "Vault and state folder paths cannot be empty." >&2; exit 1; }
for folder in "$vault" "$state"; do
  [ ! -L "$folder" ] || { echo "Use an ordinary folder instead of a symlink: $folder" >&2; exit 1; }
done
mkdir -p -- "$vault" "$state"
chmod 700 "$state"
if [ ! -f "$state/todo.sqlite" ]; then
  if [ -n "$(ls -A -- "$vault")" ]; then
    echo "An existing Markdown vault needs migration before Todo can start." >&2
    echo "Run the migration dry run in the setup guide before replacing the running server." >&2
    exit 1
  fi
  for name in owner.json initial-login.txt sessions.json tokens.json preferences.json versions todo.sqlite-wal todo.sqlite-shm todo.sqlite-journal; do
    if [ -e "$state/$name" ] || [ -L "$state/$name" ]; then
      echo "Existing Todo state has no todo.sqlite database. Check mounts, then restore a backup or migrate the original vault." >&2
      exit 1
    fi
  done
fi
docker compose up -d --build
echo "Todo started. Open ${public_origin:-http://localhost:$port}"
echo "Read the generated owner login locally in: $state/initial-login.txt"
echo "Todo stores tasks and history in: $state/todo.sqlite"
