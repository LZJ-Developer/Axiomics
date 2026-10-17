// 模型代理：租户 → DeepSeek，并在途中记账。
//
// 为什么不用 Caddy 直接反代：
//   1. Caddy 会在访问日志里把 Authorization 脱敏成 ['REDACTED']，
//      拿不到租户标识（占位符 key 是本方案唯一的租户来源）
//   2. 记账需要响应体里的 usage（input/output tokens），Caddy 无法捕获响应体
//
// 记账口径：从响应 usage 取 token，费用按 managed-pricing 的费率表折算。
// 账本追加写 JSONL，一行一次调用。

import { existsSync } from "fs"
import { dirname } from "path"

const PORT = Number(process.env.AX_MODEL_PORT ?? 43002)
// 见 activator：默认 loopback。跨机时改成内网地址，并由防火墙只放行网关。
const BIND = process.env.AX_MODEL_BIND ?? "127.0.0.1"
const UPSTREAM = process.env.AX_MODEL_UPSTREAM ?? "https://api.deepseek.com"
// 同 axiomics-activator.ts：按脚本位置推导 AX_ROOT，别写死 /srv/axiomics。
// 这里的表现比激活器温和但同样误导 —— 账本会落到不存在的目录，记账静默丢失，
// 而 `axiomics-usage` 报的是"账本为空"，看着像"没人用过"，不是"记到别处去了"。
const ROOT = (() => {
  if (process.env.AX_ROOT) return process.env.AX_ROOT
  const up = dirname(import.meta.dir)
  return existsSync(`${up}/bin`) && (existsSync(`${up}/tenants.map`) || existsSync(`${up}/logs`))
    ? up
    : "/srv/axiomics"
})()
const LEDGER = process.env.AX_LEDGER ?? `${ROOT}/logs/usage.jsonl`
const KEY_FILE = process.env.AX_KEY_FILE ?? "/dev/null"
const KEY_ENV = process.env.DEEPSEEK_KEY ?? ""

// 费率（元 / 百万 token）。来源：api-docs.deepseek.com/quick_start/pricing
const PRICES: Record<string, { in: number; out: number; cacheHit: number }> = {
  "deepseek-flash": { in: 0.15, out: 0.6, cacheHit: 0.05 },
  "deepseek-chat": { in: 0.15, out: 0.6, cacheHit: 0.05 },
  "deepseek-v4-pro": { in: 0.66, out: 1.98, cacheHit: 0.22 },
  "deepseek-reasoner": { in: 0.66, out: 1.98, cacheHit: 0.22 },
}

async function apiKey(): Promise<string> {
  if (KEY_ENV) return KEY_ENV
  const t = await Bun.file(KEY_FILE)
    .text()
    .catch(() => "")
  return t.trim()
}

function tenantOf(auth: string | null): string | null {
  // 租户容器发的占位符形如 Bearer tenant-u0001
  const m = /^Bearer\s+tenant-(u\d+)$/i.exec(auth ?? "")
  return m ? m[1] : null
}

function price(model: string) {
  for (const k of Object.keys(PRICES)) if (model.includes(k)) return PRICES[k]
  return { in: 0, out: 0, cacheHit: 0 }
}

async function record(entry: Record<string, unknown>) {
  await Bun.write(Bun.file(LEDGER), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", {
    createPath: true,
  }).catch(() => {})
}

/** 追加写（Bun.write 是覆盖，这里要用 append 语义） */
async function append(line: string) {
  const f = Bun.file(LEDGER)
  const prev = (await f.text().catch(() => "")) || ""
  await Bun.write(f, prev + line).catch(() => {})
}

Bun.serve({
  port: PORT,
  hostname: BIND,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url)
    console.log(`REQ ${req.method} ${url.pathname} auth=${req.headers.get("authorization")?.slice(0, 24) ?? "none"}`)
    if (url.pathname === "/health") return Response.json({ ok: true })
    if (!url.pathname.startsWith("/model/")) return new Response("not found", { status: 404 })

    const tenant = tenantOf(req.headers.get("authorization"))
    if (!tenant) return Response.json({ error: "unrecognized tenant placeholder" }, { status: 401 })

    const target = UPSTREAM.replace(/\/+$/, "") + url.pathname.replace(/^\/model/, "")
    let body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer()

    // 流式请求默认不带 usage —— DeepSeek 只在 stream_options.include_usage 为真时
    // 才在最后一个 chunk 里返回用量。不注入就永远记不到账。
    if (body && url.pathname.includes("/chat/completions")) {
      try {
        const j = JSON.parse(new TextDecoder().decode(body))
        if (j?.stream) {
          j.stream_options = { ...(j.stream_options ?? {}), include_usage: true }
          body = new TextEncoder().encode(JSON.stringify(j))
        }
      } catch {}
    }

    const upstream = await fetch(target + url.search, {
      method: req.method,
      headers: {
        "content-type": req.headers.get("content-type") ?? "application/json",
        authorization: `Bearer ${await apiKey()}`,
        host: new URL(UPSTREAM).host,
      },
      body: body as BodyInit | undefined,
    }).catch(() => undefined)

    if (!upstream) return Response.json({ error: "upstream unreachable" }, { status: 502 })

    const ctype = upstream.headers.get("content-type") ?? ""
    if (!ctype.includes("text/event-stream")) {
      // 非流式：直接读 body 取 usage
      const text = await upstream.text()
      let usage: any = undefined,
        model = ""
      try {
        const j = JSON.parse(text)
        usage = j.usage
        model = j.model ?? ""
      } catch {}
      if (usage) {
        const p = price(model)
        const cost =
          ((usage.prompt_cache_hit_tokens ?? 0) * p.cacheHit +
            ((usage.prompt_tokens ?? 0) - (usage.prompt_cache_hit_tokens ?? 0)) * p.in +
            (usage.completion_tokens ?? 0) * p.out) /
          1_000_000
        await append(
          JSON.stringify({
            ts: new Date().toISOString(),
            tenant,
            model,
            stream: false,
            input: usage.prompt_tokens ?? 0,
            output: usage.completion_tokens ?? 0,
            cache_hit: usage.prompt_cache_hit_tokens ?? 0,
            cost_cny: Number(cost.toFixed(6)),
            status: upstream.status,
          }) + "\n",
        )
      }
      return new Response(text, { status: upstream.status, headers: { "content-type": ctype } })
    }

    // 流式：边透传边收集最后一段 usage
    let model = ""
    let usage: any = undefined
    let tail = ""
    const reader = upstream.body!.getReader()
    const decoder = new TextDecoder()
    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          if (usage) {
            const p = price(model)
            const cost =
              ((usage.prompt_cache_hit_tokens ?? 0) * p.cacheHit +
                ((usage.prompt_tokens ?? 0) - (usage.prompt_cache_hit_tokens ?? 0)) * p.in +
                (usage.completion_tokens ?? 0) * p.out) /
              1_000_000
            await append(
              JSON.stringify({
                ts: new Date().toISOString(),
                tenant,
                model,
                stream: true,
                input: usage.prompt_tokens ?? 0,
                output: usage.completion_tokens ?? 0,
                cache_hit: usage.prompt_cache_hit_tokens ?? 0,
                cost_cny: Number(cost.toFixed(6)),
                status: upstream.status,
              }) + "\n",
            )
          }
          controller.close()
          return
        }
        tail += decoder.decode(value, { stream: true })
        // 按 SSE 帧解析，而不是用正则抓 JSON —— usage 里含嵌套对象
        // （如 prompt_tokens_details），\{[^}]*\} 会在第一个 } 处截断导致解析失败。
        for (let nl = tail.indexOf("\n"); nl >= 0; nl = tail.indexOf("\n")) {
          const line = tail.slice(0, nl).trim()
          tail = tail.slice(nl + 1)
          if (!line.startsWith("data:")) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === "[DONE]") continue
          try {
            const j = JSON.parse(payload)
            if (typeof j?.model === "string") model = j.model
            if (j?.usage) usage = j.usage
          } catch {}
        }
        if (tail.length > 65536) tail = tail.slice(-4096)
        controller.enqueue(value)
      },
      cancel() {
        reader.cancel().catch(() => {})
      },
    })
    return new Response(stream, { status: upstream.status, headers: { "content-type": ctype } })
  },
})

console.log(`model proxy on 127.0.0.1:${PORT} -> ${UPSTREAM}, ledger ${LEDGER}`)
