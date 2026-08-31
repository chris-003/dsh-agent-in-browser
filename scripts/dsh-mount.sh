#!/usr/bin/env bash
# Mount @chris-003/agent-in-browser into the DeepSeek Harness web profile.
#
# Run this from YOUR shell (not from inside the agent), because it writes to
# ~/.dsh (the DSH persistent config), which the agent sandbox cannot touch.
#
#   bash scripts/dsh-mount.sh            # mount (idempotent)
#   bash scripts/dsh-mount.sh --status   # show whether it is mounted
#   bash scripts/dsh-mount.sh --unmount  # remove the bundle entry (leaves the package)
#
# After mounting, restart/refresh the DSH web UI so the profile reloads, then
# the `browser_*` tools become available to the agent and the WebSocket server
# listens on 127.0.0.1:<port>.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PROFILE_DIR="$HOME/.dsh/profiles/web"
PACKAGE="$ROOT/agent-in-browser"
PKG_NAME="@chris-003/agent-in-browser"
PROFILE_PKG="$PROFILE_DIR/package.json"

if [[ "${1:-}" == "--status" ]]; then
  echo "profile: $PROFILE_PKG"
  if [[ -f "$PROFILE_PKG" ]] && grep -q "\"$PKG_NAME\"" "$PROFILE_PKG"; then
    echo "STATUS: mounted (listed in profile package.json)"
    grep -n "$PKG_NAME" "$PROFILE_PKG" || true
  else
    echo "STATUS: not mounted"
  fi
  echo "linked dir: ${PROFILE_DIR}/node_modules/@chris-003/agent-in-browser"
  [[ -e "$PROFILE_DIR/node_modules/@chris-003/agent-in-browser" ]] && echo "  -> link exists" || echo "  -> no link (run install)"
  exit 0
fi

if [[ ! -d "$PACKAGE" ]]; then
  echo "error: package dir not found: $PACKAGE" >&2
  exit 1
fi

if [[ "${1:-}" == "--unmount" ]]; then
  node -e '
    const fs = require("node:fs")
    const p = process.argv[1]
    const name = process.argv[2]
    const pkg = JSON.parse(fs.readFileSync(p, "utf8"))
    delete pkg.dependencies?.[name]
    if (pkg.dsh?.profile?.bundles) {
      pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== name)
      if (pkg.dsh.profile.bundles.length === 0) delete pkg.dsh.profile.bundles
    }
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n")
  ' "$PROFILE_PKG" "$PKG_NAME"
  echo "unmounted $PKG_NAME from $PROFILE_PKG"
  echo "run 'pnpm install' in $PROFILE_DIR to drop the link"
  exit 0
fi

# --- mount -------------------------------------------------------------------
node -e '
  const fs = require("node:fs")
  const p = process.argv[1]
  const name = process.argv[2]
  const path = process.argv[3]
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"))
  pkg.dependencies = pkg.dependencies || {}
  pkg.dependencies[name] = "link:" + path
  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
  if (!pkg.dsh.profile.bundles.includes(name)) pkg.dsh.profile.bundles.push(name)
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n")
' "$PROFILE_PKG" "$PKG_NAME" "$PACKAGE"

echo "added $PKG_NAME to $PROFILE_PKG"
echo "installing link into $PROFILE_DIR ..."
(
  cd "$PROFILE_DIR"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --no-frozen-lockfile 2>&1 | tail -15
  else
    npm install --no-audit --no-fund 2>&1 | tail -15
  fi
)

echo
echo "Done. To activate: restart / reload the DeepSeek Harness Web UI (the web profile)."
echo "After restart, the browser_* tools should appear to the agent and the WebSocket"
echo "server should listen on 127.0.0.1:<port> (default 38745, token 'agent-in-browser')."
