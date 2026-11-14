#!/usr/bin/env bash
# Run every test tier in order. Each tier is independent: a red unit test does
# not stop the integration tier, so one run shows the whole picture.
#
#   bash tooling/multitenant/tests/run-all.sh
#   AX_ROOT=/srv/axiomics bash tooling/multitenant/tests/run-all.sh   # + acceptance
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rc=0
declare -a names=() results=()

tier() { # <name> <command...>
  local name=$1; shift
  echo
  echo "================ $name ================"
  "$@"
  local code=$?
  names+=("$name")
  results+=("$code")
  [ "$code" -eq 0 ] || rc=1
}

PY=${PYTHON:-python3}

tier "unit: ledger puller" \
  "$PY" -m unittest discover -s "$HERE/unit" -p 'test_*.py' -v
tier "integration: ledger workflow" \
  "$PY" -m unittest discover -s "$HERE/integration" -p 'test_*.py' -v
tier "integration: user CLI" \
  bash "$HERE/integration/test_user_cli.sh"
tier "e2e: acceptance (skips without AX_ROOT)" \
  bash "$HERE/e2e/acceptance.sh"

echo
echo "================ summary ================"
for i in "${!names[@]}"; do
  printf '%-40s %s\n' "${names[$i]}" "$([ "${results[$i]}" -eq 0 ] && echo PASS || echo FAIL)"
done
exit "$rc"
