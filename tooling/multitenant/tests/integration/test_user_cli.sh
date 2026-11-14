#!/usr/bin/env bash
# Integration tier: axiomics-user against a throwaway AX_ROOT.
#
# podman and ss are stubbed on PATH, so this runs on any host and touches no
# real tenant. Each case builds its own root; the tool itself stays read-only.
#
# Run: bash tooling/multitenant/tests/integration/test_user_cli.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$HERE/../../bin/axiomics-user"
pass=0
fail=0

ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; pass=$((pass + 1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; fail=$((fail + 1)); }

make_fixture() { # <root>
  local root=$1 t
  mkdir -p "$root"/{tenants/u0001/config,tenants/u0002/config,gateway,stub}
  printf 'alice u0001 42100 0\nbob u0002 42101 0\n' >"$root/tenants.map"
  for t in u0001 u0002; do
    printf 'token-%s\n' "$t" >"$root/tenants/$t/token"
    chmod 600 "$root/tenants/$t/token"
  done
  printf 'alice u0001\nbob u0002\n' >"$root/gateway/tenants.caddy"
  printf 'u0001 127.0.0.1:42100\nu0002 127.0.0.1:42101\n' >"$root/gateway/upstreams.caddy"
  printf 'u0001 /tenants/u0001/token\nu0002 /tenants/u0002/token\n' >"$root/gateway/tokens.caddy"
  cat >"$root/stub/podman" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *"name=^ax-u0001$"*) echo ax-u0001 ;;
  *"name=^ax-u0002$"*) echo ax-u0002 ;;
  *) : ;;
esac
SH
  cat >"$root/stub/ss" <<'SH'
#!/usr/bin/env bash
exit 0
SH
  chmod +x "$root/stub/podman" "$root/stub/ss"
}

run() { # <root> <args...>
  AX_ROOT="$1" PATH="$1/stub:$PATH" "$CLI" "${@:2}" 2>&1
}

expect_ok() { # <label> <root> <args...>
  local label=$1 root=$2 out rc
  out=$(run "$root" "${@:3}"); rc=$?
  if [ $rc -eq 0 ]; then ok "$label"; else bad "$label (rc=$rc) $out"; fi
}

expect_fail_contains() { # <label> <needle> <root> <args...>
  local label=$1 needle=$2 root=$3 out rc
  out=$(run "$root" "${@:4}"); rc=$?
  if [ $rc -ne 0 ] && grep -q -- "$needle" <<<"$out"; then
    ok "$label"
  else
    bad "$label (rc=$rc, want '$needle') $out"
  fi
}

expect_ok_contains() { # <label> <needle> <root> <args...>
  local label=$1 needle=$2 root=$3 out rc
  out=$(run "$root" "${@:4}"); rc=$?
  if [ $rc -eq 0 ] && grep -q -- "$needle" <<<"$out"; then
    ok "$label"
  else
    bad "$label (rc=$rc, want '$needle') $out"
  fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "axiomics-user: consistent fixture"
make_fixture "$TMP/base"
expect_ok_contains "check reports a consistent root" "OK GPU 侧一致：2 个用户" "$TMP/base" check
expect_ok "check --quiet exits 0" "$TMP/base" check --quiet

echo "axiomics-user: drift is named, not just non-zero"
cp -a "$TMP/base" "$TMP/no_token"
rm "$TMP/no_token/tenants/u0002/token"
expect_fail_contains "missing token" "缺 token" "$TMP/no_token" check

cp -a "$TMP/base" "$TMP/dup_port"
sed -i 's/bob u0002 42101 0/bob u0002 42100 0/' "$TMP/dup_port/tenants.map"
expect_fail_contains "duplicate port" "端口重复" "$TMP/dup_port" check

cp -a "$TMP/base" "$TMP/extra_user"
printf 'carol u0009 42109 0\n' >>"$TMP/extra_user/gateway/tenants.caddy"
expect_fail_contains "gateway keeps a deleted user" "多余" "$TMP/extra_user" check

cp -a "$TMP/base" "$TMP/missing_upstream"
sed -i '/u0002/d' "$TMP/missing_upstream/gateway/upstreams.caddy"
expect_fail_contains "gateway misses an upstream" "upstreams.caddy 缺" "$TMP/missing_upstream" check

echo "axiomics-user: dry-run allocation"
expect_ok_contains "add picks the next id and free port" "u0003" "$TMP/base" add carol
out=$(run "$TMP/base" add carol)
grep -q "42102" <<<"$out" && ok "add skips the port already in tenants.map" \
  || bad "add should pick 42102, got: $out"
grep -q "不会执行任何命令" <<<"$out" && ok "add states that it is a dry run" \
  || bad "add output does not say dry-run"

expect_fail_contains "duplicate user is refused" "已在 tenants.map" "$TMP/base" add alice
expect_fail_contains "--apply is refused" "只支持 dry-run" "$TMP/base" add dave --apply
expect_fail_contains "invalid name is refused" "用户名不合法" "$TMP/base" add 1bad
expect_fail_contains "absent user cannot be deleted" "没有" "$TMP/base" del ghost

expect_ok_contains "del previews the tenant" "u0002" "$TMP/base" del bob

echo
printf '结果：通过 %d 失败 %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
