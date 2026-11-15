#!/usr/bin/env bash
# 余额可观测的端到端验证：假上游 + 真代理，不用真密钥、不打真模型。
#
# 为什么需要这条测试：余额耗尽是账本里**看不见**的故障 —— 失败的调用没有 usage，
# 代理一行账都不会写。于是"账本不动"既能读成"没人用"，也能读成"账户没钱了"。
# 这里断言三件事：
#   1. /health 把余额说出来，且 ok 不受余额影响（进程健康 ≠ 账户健康）
#   2. 余额查询有缓存，健康检查不会每分钟打上游
#   3. 上游 402 时缓存立刻失效，下一次 /health 报的就是新真相
set -uo pipefail

BUN=${BUN:-$(command -v bun || echo "$HOME/.bun/bin/bun")}
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY="$HERE/../../bin/axiomics-model-proxy.ts"
TMP=$(mktemp -d)
PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  rm -rf "$TMP"
}
trap cleanup EXIT

port() {
  python3 - <<'PY'
import socket
s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()
PY
}

UP_PORT=$(port)
PX_PORT=$(port)

cat > "$TMP/upstream.ts" <<'TS'
// 只实现代理会调用的两条路由。/calls 用来证明余额查询被缓存了。
let calls = 0
Bun.serve({
  port: Number(process.env.UP_PORT),
  hostname: "127.0.0.1",
  fetch(req) {
    const path = new URL(req.url).pathname
    if (path === "/calls") return new Response(String(calls))
    if (path === "/user/balance") {
      calls++
      return Response.json({
        is_available: false,
        balance_infos: [{ currency: "CNY", total_balance: "-0.38" }],
      })
    }
    if (path === "/v1/chat/completions")
      return Response.json({ error: { message: "Insufficient Balance", type: "unknown_error" } }, { status: 402 })
    return new Response("not found", { status: 404 })
  },
})
TS

printf 'tester u0003 42100 1\n' > "$TMP/tenants.map"
printf 'sk-not-a-real-key\n' > "$TMP/key"
: > "$TMP/usage.jsonl"

# 本机常配着全局代理（127.0.0.1:10808）。Bun 的 fetch 会照用，回环请求于是
# 被代理转成 503 —— 看起来像"上游挂了"，实际是测试环境问题。回环必须绕开。
NOPROXY=(env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy
  NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost)

"${NOPROXY[@]}" UP_PORT=$UP_PORT "$BUN" run "$TMP/upstream.ts" >"$TMP/upstream.log" 2>&1 &
PIDS+=($!)
"${NOPROXY[@]}" AX_ROOT="$TMP" \
AX_MODEL_PORT="$PX_PORT" \
AX_MAP="$TMP/tenants.map" \
AX_KEY_FILE="$TMP/key" \
AX_LEDGER="$TMP/usage.jsonl" \
AX_MODEL_UPSTREAM="http://127.0.0.1:$UP_PORT" \
  "$BUN" run "$PROXY" >"$TMP/proxy.log" 2>&1 &
PIDS+=($!)

CURL=(curl -s --noproxy '*' -m 5)
for _ in $(seq 1 50); do
  "${CURL[@]}" "http://127.0.0.1:$PX_PORT/health" >/dev/null 2>&1 && break
  sleep 0.1
done

fail=0
check() { # <描述> <期望子串> <实际>
  if [[ "$3" == *"$2"* ]]; then
    printf '  \033[32m✓\033[0m %s\n' "$1"
  else
    printf '  \033[31m✗\033[0m %s\n      期望包含: %s\n      实际: %s\n' "$1" "$2" "$3"
    fail=$((fail + 1))
  fi
}

health1=$("${CURL[@]}" "http://127.0.0.1:$PX_PORT/health")
check "健康探针仍报 ok（进程健康与余额解耦）" '"ok":true' "$health1"
check "健康探针报出余额 -0.38" '"total_balance":"-0.38"' "$health1"
check "健康探针标记账户不可用" '"is_available":false' "$health1"
check "健康探针标记低余额" '"low":true' "$health1"

"${CURL[@]}" "http://127.0.0.1:$PX_PORT/health" >/dev/null
calls_cached=$("${CURL[@]}" "http://127.0.0.1:$UP_PORT/calls")
check "60s 内重复探针不重复查询上游" "1" "$calls_cached"

status=$("${CURL[@]}" -o "$TMP/msg.json" -w '%{http_code}' \
  -H 'Authorization: Bearer tenant-u0003' -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"x"}]}' \
  "http://127.0.0.1:$PX_PORT/model/v1/chat/completions")
check "上游 402 原样透传给租户" "402" "$status"
if [ -s "$TMP/usage.jsonl" ]; then
  printf '  \033[31m✗\033[0m 账本里不该有 402 的行，实际: %s\n' "$(cat "$TMP/usage.jsonl")"
  fail=$((fail + 1))
else
  printf '  \033[32m✓\033[0m 账本里不留 402（无 usage 就无账 —— 这正是它不可见的原因）\n'
fi
check "日志里有可 grep 的上游失败" "UPSTREAM 402 tenant=u0003" "$(cat "$TMP/proxy.log")"

"${CURL[@]}" "http://127.0.0.1:$PX_PORT/health" >/dev/null
calls_after=$("${CURL[@]}" "http://127.0.0.1:$UP_PORT/calls")
check "402 之后余额缓存失效并重新查询" "2" "$calls_after"

if [ "$fail" -eq 0 ]; then
  echo "  全部通过"
else
  echo "  $fail 项失败"
fi
exit "$fail"
