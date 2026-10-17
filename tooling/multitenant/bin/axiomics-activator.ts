// 按需激活器：Caddy 在认证之后调用它，负责把被回收的租户拉起来。
//
// 为什么必须有它：回收把空闲容器停掉，若不激活，下一个请求直接 502。
// Caddy 不会启动容器，所以这一层不可省。
//
// 调用方式（Caddyfile，在 forward_auth 认证之后）：
//   forward_auth 127.0.0.1:9300 { uri /ensure }
// 认证那一步已经 copy_headers 了 Remote-User，所以这里能直接读到身份。

import { existsSync } from "fs"
import { dirname } from "path"

const PORT = Number(process.env.AX_ACTIVATOR_PORT ?? 9300)
// 绑定地址：默认只绑 loopback（单机部署的安全默认）。拆成多机时网关在另一台，
// 才需要改成内网地址，**并且必须用防火墙只放行网关那一台** —— 激活器没有鉴权，
// 谁能连上谁就能拉起任意租户。
const BIND = process.env.AX_ACTIVATOR_BIND ?? "127.0.0.1"
// AX_ROOT 未设时按脚本自身位置推导（部署后就在 $AX_ROOT/bin/ 下）—— 与
// bin/axiomics-tenant 那几个 shell 脚本同一套逻辑，**刻意内联**而非抽公共模块：
// 这些文件是被逐个 install 的，少装一个模块就整片失效。
//
// 少了这段的后果实测过：手工起一个激活器（没带 deploy.sh 那串 env）会去读
// 不存在的 /srv/axiomics/tenants.map，map 解析成空数组 → **每个已认证用户都
// 拿到 403 "no tenant"**（同一个 lzj，生产返回 200）。症状像权限问题，实为
// 路径问题，且没有任何一处日志会提到 /srv/axiomics。
const ROOT = (() => {
  if (process.env.AX_ROOT) return process.env.AX_ROOT
  const up = dirname(import.meta.dir)
  // 只认"像运行时根"的目录，否则退回 /srv/axiomics：免得在仓库里原地跑时
  // 把源码目录当成运行时根。
  return existsSync(`${up}/bin`) && (existsSync(`${up}/tenants.map`) || existsSync(`${up}/logs`))
    ? up
    : "/srv/axiomics"
})()
const MAP = process.env.AX_MAP ?? `${ROOT}/tenants.map`
const TENANT_CMD = process.env.AX_TENANT_CMD ?? `${ROOT}/bin/axiomics-tenant`
const READY_TIMEOUT_MS = Number(process.env.AX_READY_TIMEOUT_MS ?? 45_000)
const AUDIT = process.env.AX_AUDIT ?? `${ROOT}/logs/audit.jsonl`

// map 读不到时**必须吵**：不吵的话表现是全体 403，而 403 的文案是 "no tenant"，
// 会把人引向"权限/租户没开通"，而不是"map 路径不对"。
if (!existsSync(MAP)) {
  console.error(`[激活器] 租户映射表不存在：${MAP}`)
  console.error(`[激活器] 所有已认证请求都会得到 403 —— 这几乎总是路径问题，不是权限问题。`)
  console.error(`[激活器] AX_ROOT=${process.env.AX_ROOT ?? "(未设，按脚本位置推导)"} 推导结果 ROOT=${ROOT}`)
}

// 审计点：激活器在每个已认证请求上被调用，且能读到 Remote-User。
// Caddy 的访问日志记的是认证前的请求，不含身份，所以审计放在这里。
async function audit(entry: Record<string, unknown>) {
  const f = Bun.file(AUDIT)
  const prev = (await f.text().catch(() => "")) || ""
  await Bun.write(f, prev + JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n").catch(() => {})
}

type Row = { user: string; tid: string; port: string; gpu: string }

async function map(): Promise<Row[]> {
  const text = await Bun.file(MAP)
    .text()
    .catch(() => "")
  return text
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length >= 3)
    .map(([user, tid, port, gpu]) => ({ user, tid, port, gpu: gpu ?? "0" }))
}

async function running(tid: string): Promise<boolean> {
  const p = Bun.spawn(["podman", "ps", "--filter", `name=^ax-${tid}$`, "--format", "{{.Names}}"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const out = await new Response(p.stdout).text().catch(() => "")
  return out.trim().length > 0
}

async function healthy(port: string): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/global/health`, {
      headers: { Host: "127.0.0.1:4096" },
      signal: AbortSignal.timeout(2000),
    })
    return r.ok
  } catch {
    return false
  }
}

async function ensure(tid: string, port: string): Promise<"ready" | "timeout"> {
  if (await running(tid)) return (await healthy(port)) ? "ready" : "timeout"

  // 已停：拉起并等到可服务。冷启动实测约 0.8 秒起、再加 Bun 启动。
  Bun.spawn([TENANT_CMD, "start", tid], { stdout: "ignore", stderr: "ignore" })
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    await Bun.sleep(300)
    if (await healthy(port)) return "ready"
  }
  return "timeout"
}

Bun.serve({
  port: PORT,
  hostname: BIND,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/health") return Response.json({ ok: true })
    if (url.pathname !== "/ensure") return new Response("not found", { status: 404 })

    const user = req.headers.get("remote-user") ?? ""
    const row = (await map()).find((r) => r.user === user)
    if (!row) return new Response("no tenant", { status: 403 })

    const t0 = Date.now()
    const state = await ensure(row.tid, row.port)
    const ms = Date.now() - t0
    await audit({ user, tenant: row.tid, event: "access", woken: ms > 400, wake_ms: ms, result: state })
    if (state === "ready") {
      console.log(`ensure ${user} -> ${row.tid} ok (${ms}ms)`)
      return new Response(null, { status: 200 })
    }
    console.log(`ensure ${user} -> ${row.tid} TIMEOUT (${ms}ms)`)
    return new Response("tenant unavailable", { status: 503 })
  },
})

console.log(`activator listening on 127.0.0.1:${PORT}`)
