#!/bin/sh
set -eu

REPOSITORY="https://github.com/skz7s/Todo-Harness.git"
INSTALL_DIR="${TODO_HARNESS_INSTALL_DIR:-${1:-$HOME/.local/share/todo-harness/app}}"

fail() {
  printf 'Todo Harness installer: %s\n' "$1" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "Git is required. Install Git and run this command again."
command -v node >/dev/null 2>&1 || fail "Node.js 20 or newer is required. Install Node.js and run this command again."
command -v npm >/dev/null 2>&1 || fail "npm is required. Install Node.js with npm and run this command again."

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20 or newer is required (found $(node --version))."
mkdir -p "$(dirname "$INSTALL_DIR")"

if [ -e "$INSTALL_DIR" ]; then
  [ -d "$INSTALL_DIR/.git" ] || fail "$INSTALL_DIR exists and is not a Todo Harness Git checkout."
  [ -z "$(git -C "$INSTALL_DIR" status --porcelain)" ] || fail "The installation has local changes. Preserve them, then update it manually."
  git -C "$INSTALL_DIR" fetch --depth 1 origin main
  git -C "$INSTALL_DIR" merge --ff-only origin/main
else
  git clone --depth 1 --branch main "$REPOSITORY" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
npm ci --omit=dev
exec npm start
