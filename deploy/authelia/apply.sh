#!/usr/bin/env bash
# Authelia login-portal branding: DRY-RUN apply plan (ADR 0002).
#
# This script is a planner, not an installer. It checks the local assets and
# prints the exact commands an operator would run. It never invokes podman or
# curl, never edits a config file, and never touches the running container.
# `--run` is accepted only so the refusal is explicit.
#
# Usage: bash apply.sh [--dry-run] | --help

set -euo pipefail

CONTAINER=${AUTHELIA_CONTAINER:-ax-authelia}
HOST_ASSETS=${AUTHELIA_HOST_ASSETS:-/disk1/dabiao/axiomics-mt/auth/assets}
CONTAINER_ASSETS=${AUTHELIA_CONTAINER_ASSETS:-/config/assets}
CONFIG=/disk1/dabiao/axiomics-mt/auth/portless.yml
DEAD_CONFIG=/disk1/dabiao/axiomics-mt/auth/configuration.yml
TEMPLATE=/disk1/dabiao/project/axiomics/tooling/multitenant/auth/portless.yml.tmpl
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

say() { printf '%s\n' "$*"; }
plan() { printf '  $ %s\n' "$*"; }
phase() { printf '\n== %s ==\n' "$*"; }
die() {
  printf 'apply.sh: %s\n' "$*" >&2
  exit 1
}

case ${1:-} in
--help | -h)
  say "apply.sh - print (never run) the Authelia branding apply commands."
  say ""
  say "  --dry-run   print the plan (default)"
  say "  --run       refused on purpose; run the printed commands yourself"
  exit 0
  ;;
--run)
  printf 'apply.sh: refusing to execute: this is a dry-run planner.\n' >&2
  printf 'apply.sh: review the printed commands and run them yourself.\n' >&2
  exit 2
  ;;
--dry-run | "") ;;
*)
  die "unknown argument: $1 (try --help)"
  ;;
esac

for file in logo.png favicon.ico locales/en/portal.json locales/zh-CN/portal.json; do
  [[ -f $SOURCE/assets/$file ]] || die "missing asset: $SOURCE/assets/$file"
done

png=$(od -An -tx1 -N4 "$SOURCE/assets/logo.png" | tr -d ' \n')
[[ $png == 89504e47 ]] || die "logo.png is not a PNG (magic $png)"
ico=$(od -An -tx1 -N4 "$SOURCE/assets/favicon.ico" | tr -d ' \n')
[[ $ico == 00000100 ]] || die "favicon.ico is not a single-type ICO (magic $ico)"

if command -v python3 >/dev/null; then
  for file in locales/en/portal.json locales/zh-CN/portal.json; do
    python3 -I -m json.tool "$SOURCE/assets/$file" >/dev/null ||
      die "invalid JSON: assets/$file"
  done
fi

phase "0. preflight (read-only, already done by this script)"
say "  container:    $CONTAINER"
say "  host assets:  $HOST_ASSETS"
say "  mount:        $HOST_ASSETS -> $CONTAINER_ASSETS (rw, no new volume needed)"
say "  live config:  $CONFIG  (the only config Authelia loads)"
say "  dead config:  $DEAD_CONFIG  (not loaded, editing it does nothing)"
say "  template:     $TEMPLATE"
say "  assets:"
(
  cd "$SOURCE/assets"
  sha256sum logo.png favicon.ico locales/en/portal.json locales/zh-CN/portal.json | sed 's/^/    /'
)

phase "1. install assets into $CONTAINER_ASSETS"
say "  /config is bind-mounted from the host, so these writes land in $HOST_ASSETS."
plan "podman exec $CONTAINER install -d -m 0755 $CONTAINER_ASSETS $CONTAINER_ASSETS/locales/en $CONTAINER_ASSETS/locales/zh-CN"
plan "podman cp $SOURCE/assets/logo.png $CONTAINER:$CONTAINER_ASSETS/logo.png"
plan "podman cp $SOURCE/assets/favicon.ico $CONTAINER:$CONTAINER_ASSETS/favicon.ico"
plan "podman cp $SOURCE/assets/locales/en/portal.json $CONTAINER:$CONTAINER_ASSETS/locales/en/portal.json"
plan "podman cp $SOURCE/assets/locales/zh-CN/portal.json $CONTAINER:$CONTAINER_ASSETS/locales/zh-CN/portal.json"
plan "podman exec $CONTAINER chmod 0644 $CONTAINER_ASSETS/logo.png $CONTAINER_ASSETS/favicon.ico $CONTAINER_ASSETS/locales/en/portal.json $CONTAINER_ASSETS/locales/zh-CN/portal.json"

phase "2. enable server.asset_path in BOTH config files"
say "  Add this line under the existing 'server:' mapping, keeping 'address:':"
say "      asset_path: /config/assets"
say ""
plan "cp -a $CONFIG $CONFIG.bak-<timestamp>"
plan "cp -a $TEMPLATE $TEMPLATE.bak-<timestamp>"
plan "<edit $CONFIG>    add '  asset_path: /config/assets' under server:"
plan "<edit $TEMPLATE>  add '  asset_path: /config/assets' under server:"
say ""
say "  Existing deployments do not pick the template up automatically: deploy.sh"
say "  only renders it when portless.yml is absent. Edit the live file by hand."
say "  Do NOT edit $DEAD_CONFIG: --config on the command line wins over it."

phase "3. validate before restarting"
say "  This reads $CONTAINER_ASSETS. A bad JSON file or a dropped placeholder is"
say "  fatal here rather than on the login page."
plan "podman exec $CONTAINER /app/authelia validate-config --config /config/portless.yml"

phase "4. restart (asset_path is a startup option; there is no reload)"
plan "podman restart $CONTAINER"
say "  Expect a few seconds of login outage. Do not recreate the container:"
say "  /config is already mounted, so a restart is enough."

phase "5. assertions"
plan "curl -s -o /dev/null -w '%{http_code} %{content_type}\\n' http://127.0.0.1:9091/auth/static/media/logo.png"
plan "curl -s -o /dev/null -w '%{http_code} %{content_type}\\n' http://127.0.0.1:9091/auth/favicon.ico"
plan "curl -s http://127.0.0.1:9091/auth/ | grep -o 'data-logooverride=\"[a-z]*\"'"
plan "curl -s http://127.0.0.1:9091/auth/locales/zh-CN/portal.json"
plan "curl -sk -o /dev/null -w '%{http_code}\\n' https://<gateway>/auth/"
say "  Expect: 200 image/png, 200 image/vnd.microsoft.icon, data-logooverride=\"true\","
say "  the zh-CN JSON body, and 200 from the gateway. The login page is served under"
say "  /auth, so /auth/static/... is the real resource path; a bare /static/... 302"
say "  is expected and is not an override failure."

phase "6. rollback"
say "  Remove the asset_path line from $CONFIG and $TEMPLATE, then:"
plan "podman restart $CONTAINER"
say "  The assets directory can stay on disk; it is inert without asset_path."

phase "notes"
say "  - '{{authelia}}' is interpolated by the web bundle and is hardcoded to"
say "    'Authelia'; the tab title, manifest and footer link cannot be removed."
say "  - Never drop '{{authelia}}' from a value whose key contains it: Authelia"
say "    refuses to start with \"has a value which is missing a required placeholder\"."
say "  - This script executed nothing. Exit status 0 means the plan printed only."
