#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SSH_TARGET="${PI_WEB_SSH_TARGET:-dmit-tyo-tiny}"
SERVICE="${PI_WEB_SERVICE:-tokyo-pi-web.service}"
REMOTE_PACKAGE="${PI_WEB_REMOTE_PACKAGE:-/opt/pi-web/node_modules/@agegr/pi-web}"
REMOTE_RELEASE_ROOT="${PI_WEB_REMOTE_RELEASE_ROOT:-/opt/pi-web-releases}"
REMOTE_OWNER="${PI_WEB_REMOTE_OWNER:-codex-agent:codex-agent}"
HEALTH_URL="${PI_WEB_HEALTH_URL:-http://127.0.0.1:30141/}"

BUILD="${PI_WEB_BUILD:-1}"
NPM_INSTALL="${PI_WEB_NPM_INSTALL:-auto}"
ALLOW_DIRTY="${PI_WEB_ALLOW_DIRTY:-0}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

for cmd in git ssh scp tar rsync npm; do
  need_cmd "$cmd"
done

if [[ "$ALLOW_DIRTY" != "1" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree is dirty; commit first or run with PI_WEB_ALLOW_DIRTY=1" >&2
  git status --short >&2
  exit 1
fi

case "$NPM_INSTALL" in
  auto)
    if [[ ! -d node_modules ]]; then
      npm ci
    fi
    ;;
  always)
    npm ci
    ;;
  never)
    ;;
  *)
    echo "PI_WEB_NPM_INSTALL must be auto, always, or never" >&2
    exit 1
    ;;
esac

if [[ "$BUILD" != "0" ]]; then
  npm run build
fi

if [[ ! -d .next ]]; then
  echo ".next is missing; run npm run build or set PI_WEB_BUILD=1" >&2
  exit 1
fi

tmp_root="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_root"
}
trap cleanup EXIT

stage="$tmp_root/stage"
file_list="$tmp_root/files.txt"
archive="$tmp_root/pi-web-runtime.tgz"
mkdir -p "$stage"

git ls-files > "$file_list"
rsync -a --files-from="$file_list" "$ROOT"/ "$stage"/
rsync -a --delete \
  --exclude='cache' \
  --exclude='dev' \
  --exclude='*.js.map' \
  "$ROOT/.next/" "$stage/.next/"

rm -rf "$stage/node_modules" "$stage/.next/cache" "$stage/.next/dev"
rm -f "$stage/package-lock.json" "$stage/bun.lock"
find "$stage" \( -name '._*' -o -name '.DS_Store' \) -delete
COPYFILE_DISABLE=1 tar -C "$stage" -czf "$archive" .

remote_archive="/tmp/pi-web-runtime-$(date -u +%Y%m%dT%H%M%SZ)-$$.tgz"
scp "$archive" "$SSH_TARGET:$remote_archive"

ssh "$SSH_TARGET" \
  "REMOTE_ARCHIVE='$remote_archive' REMOTE_PACKAGE='$REMOTE_PACKAGE' REMOTE_RELEASE_ROOT='$REMOTE_RELEASE_ROOT' REMOTE_OWNER='$REMOTE_OWNER' SERVICE='$SERVICE' HEALTH_URL='$HEALTH_URL' bash -s" <<'REMOTE'
set -euo pipefail

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$REMOTE_RELEASE_ROOT/backup-$timestamp"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
  rm -f "$REMOTE_ARCHIVE"
}
trap cleanup EXIT

rollback() {
  echo "deploy failed; rolling back to $backup" >&2
  if [[ -d "$backup" ]]; then
    rm -rf "$REMOTE_PACKAGE"
    cp -a "$backup" "$REMOTE_PACKAGE"
    chown -R "$REMOTE_OWNER" "$REMOTE_PACKAGE"
    systemctl restart "$SERVICE" || true
  fi
  exit 1
}

install -d -m 0755 "$REMOTE_RELEASE_ROOT"
test -f "$REMOTE_ARCHIVE"
tar -xzf "$REMOTE_ARCHIVE" -C "$tmp_dir"
test -f "$tmp_dir/package.json"
test -d "$tmp_dir/.next"

if [[ -d "$REMOTE_PACKAGE" ]]; then
  cp -a "$REMOTE_PACKAGE" "$backup"
fi

rm -rf "$REMOTE_PACKAGE"
install -d -m 0755 "$REMOTE_PACKAGE"
cp -a "$tmp_dir"/. "$REMOTE_PACKAGE"/
chown -R "$REMOTE_OWNER" "$REMOTE_PACKAGE"

systemctl restart "$SERVICE" || rollback
sleep 2
curl -fsSI "$HEALTH_URL" >/dev/null || rollback
systemctl is-active --quiet "$SERVICE" || rollback

echo "deployed $REMOTE_PACKAGE"
echo "backup $backup"
REMOTE
