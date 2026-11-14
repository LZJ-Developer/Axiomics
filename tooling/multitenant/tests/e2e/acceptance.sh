#!/usr/bin/env bash
# Acceptance tier: run the shipped self-checks against a real deployment.
#
# This is the only tier that touches live services. It is skipped unless
# AX_ROOT points at an installed root, so CI without a deployment stays green.
#
# Run: AX_ROOT=/srv/axiomics bash tooling/multitenant/tests/e2e/acceptance.sh
set -uo pipefail

if [ -z "${AX_ROOT:-}" ] || [ ! -x "$AX_ROOT/bin/axiomics-verify" ]; then
  echo "SKIP 未提供可用的 AX_ROOT（真实部署根），跳过验收层"
  exit 0
fi

pass=0
fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; pass=$((pass + 1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; fail=$((fail + 1)); }

echo "验收 1/3：部署自检 axiomics-verify"
verify_out=$(AX_ROOT="$AX_ROOT" "$AX_ROOT/bin/axiomics-verify" 2>&1)
verify_rc=$?
printf '%s\n' "$verify_out" | tail -1
if [ "$verify_rc" -eq 0 ] && grep -qE '通过 [0-9]+ +失败 0' <<<"$verify_out"; then
  ok "axiomics-verify 失败 0"
else
  bad "axiomics-verify 未通过（rc=$verify_rc）"
  printf '%s\n' "$verify_out" | grep -E '✗|FAIL' | sed 's/^/    /' || true
fi

echo "验收 2/3：GPU 侧配置一致性"
if AX_ROOT="$AX_ROOT" "$AX_ROOT/bin/axiomics-user" check --quiet >/tmp/ax_e2e_user.$$ 2>&1; then
  ok "tenants.map ↔ gateway ↔ 目录 ↔ token 一致"
else
  bad "配置漂移"
  sed 's/^/    /' /tmp/ax_e2e_user.$$
fi
rm -f /tmp/ax_e2e_user.$$

echo "验收 3/3：账本拉取新鲜度（仅装了 health 脚本时）"
HEALTH="$HOME/.local/bin/axiomics-health.py"
PY="$HOME/.local/venv-axiomics/bin/python"
if [ -x "$HEALTH" ] || [ -f "$HEALTH" ]; then
  if [ -x "$PY" ]; then
    health_out=$("$PY" "$HEALTH" 2>&1)
    health_rc=$?
    printf '%s\n' "$health_out" | sed 's/^/    /'
    if [ "$health_rc" -eq 0 ] && ! grep -qE '(FAIL|WARN)' <<<"$health_out"; then
      ok "health 全绿"
    else
      bad "health 有红项（rc=$health_rc）"
    fi
  else
    echo "  - 有 health 脚本但缺 venv，跳过"
  fi
else
  echo "  - 本机没有 axiomics-health.py（它在 Web 侧），跳过"
fi

echo
printf '验收结果：通过 %d 失败 %d\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
