/** Model v2 validator: mechanical invariants + stats + time-travel snapshot probe. */
import { digestOf, HEX64, INLINE_MAX, isIgnored, type Ev } from "./schema"

export type Check = { name: string; fn: () => string[] }
export type Report = { errors: string[]; warnings: string[]; stats: Record<string, string | number> }

const KINDS = new Set([
  "meta",
  "msg",
  "tool_start",
  "tool_out",
  "tool_end",
  "fs_write",
  "fs_delete",
  "fs_move",
  "artifact",
  "state",
  "note",
])

export function validate(events: Ev[], haveBlob: (d: string) => boolean, opts: { at?: number[] } = {}): Report {
  const errors: string[] = []
  const warnings: string[] = []
  const pushErr = (m: string) => errors.push(m)
  const checks: Check[] = [
    {
      name: "seq 严格递增且连续(0..n-1)",
      fn: () => events.map((e, k) => (e.seq === k ? null : `seq[${k}]=${e.seq}`)).filter(Boolean) as string[],
    },
    {
      name: "kind 在白名单",
      fn: () =>
        events
          .filter((e) => !KINDS.has(e.kind))
          .map((e) => `bad kind @${e.seq}: ${JSON.stringify((e as { kind: string }).kind)}`),
    },
    {
      name: "digest 形态 (64hex)",
      fn: () => {
        const out: string[] = []
        for (const e of events) {
          if (e.kind === "fs_write" && !HEX64.test(e.digest)) out.push(`fs digest @${e.seq}`)
          if ((e.kind === "tool_end" && (e.out?.digest || e.err?.digest)) || e.kind === "artifact") {
            const d =
              e.kind === "artifact"
                ? e.digest
                : ((e as { out?: { digest: string } }).out?.digest ?? (e as { err?: { digest: string } }).err?.digest!)
            if (!HEX64.test(d)) out.push(`ref digest @${e.seq}`)
          }
        }
        return out
      },
    },
    {
      name: "fs 只记录非 ignore 路径",
      fn: () =>
        events
          .filter((e) => e.kind === "fs_write" || e.kind === "fs_delete" || e.kind === "fs_move")
          .filter((e) => isIgnored(e.kind === "fs_move" ? e.to : (e as { path: string }).path))
          .map((e) => `ignored path @${e.seq}: ${JSON.stringify(e)}`),
    },
    {
      name: "inline 文本自洽且 ≤INLINE_MAX",
      fn: () =>
        events
          .filter(
            (e): e is Extract<Ev, { kind: "fs_write"; text?: string }> => e.kind === "fs_write" && e.text !== undefined,
          )
          .map((e) => {
            const len = Buffer.byteLength(e.text!, "utf8")
            if (len !== e.bytes) return `fs bytes @${e.seq}: text=${len} declared=${e.bytes}`
            if (digestOf(e.text!) !== e.digest) return `fs digest mismatch @${e.seq}`
            if (len > INLINE_MAX) return `fs inline too big @${e.seq}: ${len}>${INLINE_MAX} (should be a blob ref)`
            return null
          })
          .filter(Boolean) as string[],
    },
    {
      name: "fs prev 链一致 + delete/move 存在性",
      fn: () => {
        const last = new Map<string, string>()
        const out: string[] = []
        for (const e of events) {
          if (e.kind === "fs_write") {
            const prev = last.get(e.path) ?? null
            if (e.prev !== prev) out.push(`prev mismatch @${e.seq} ${e.path}: declared=${e.prev} actual=${prev}`)
            last.set(e.path, e.digest)
          } else if (e.kind === "fs_delete") {
            if (!last.has(e.path)) out.push(`delete of missing file @${e.seq} ${e.path}`)
            last.delete(e.path)
          } else if (e.kind === "fs_move") {
            if (!last.has(e.from)) out.push(`move of missing file @${e.seq} ${e.from}`)
            if (last.has(e.to)) out.push(`move onto existing file @${e.seq} ${e.to}`)
            const d = last.get(e.from)
            last.delete(e.from)
            if (d) last.set(e.to, d)
          }
        }
        return out
      },
    },
    {
      name: "span 成对且无泄漏",
      fn: () => {
        const stk: string[] = []
        const out: string[] = []
        for (const e of events) {
          if (e.kind === "tool_start") stk.push(e.span ?? "")
          else if (e.kind === "tool_out" || e.kind === "tool_end") {
            const want = stk[stk.length - 1]
            if (want !== e.span) out.push(`${e.kind} @${e.seq} span=${e.span} 期望 ${want}`)
            if (e.kind === "tool_end") stk.pop()
          }
        }
        if (stk.length) out.push(`未闭合 span: ${stk.join(",")}`)
        return out
      },
    },
    {
      name: "Ref/artifact/blob 存在性",
      fn: () => {
        const out: string[] = []
        for (const e of events) {
          if (e.kind === "tool_end") {
            for (const r of [e.out, e.err]) if (r && !haveBlob(r.digest)) out.push(`缺 blob @${e.seq} ${r.digest}`)
          } else if (e.kind === "artifact") {
            if (!haveBlob(e.digest)) out.push(`缺 artifact blob @${e.seq} ${e.name}`)
          } else if (e.kind === "fs_write" && !e.text && !haveBlob(e.digest)) {
            out.push(`缺大文本 blob @${e.seq} ${e.path}`)
          }
        }
        return out
      },
    },
  ]
  for (const c of checks) for (const m of c.fn()) pushErr(m)

  // warnings
  for (const e of events) {
    if (e.kind === "fs_write" && e.prev === e.digest)
      warnings.push(`无变化重写 @${e.seq} ${e.path}（digest 未变，去重生效）`)
    if (e.kind === "msg" && e.text.length > INLINE_MAX) warnings.push(`长 msg @${e.seq}（${e.text.length}B）建议走 Ref`)
  }

  const perKind: Record<string, number> = {}
  for (const e of events) perKind[e.kind] = (perKind[e.kind] ?? 0) + 1
  const ledgerBytes = events.reduce((s, e) => s + JSON.stringify(e).length, 0)
  const refBytes = events.reduce(
    (s, e) =>
      s +
      (e.kind === "artifact"
        ? e.bytes
        : e.kind === "tool_end"
          ? (e.out?.bytes ?? 0) + (e.err?.bytes ?? 0)
          : e.kind === "fs_write" && !e.text
            ? e.bytes
            : 0),
    0,
  )
  const n = events.length
  const C = 64
  const stats: Report["stats"] = {
    events: n,
    ledgerBytes,
    refBytes,
    "朴素全扫(拖整条时间轴估算)": `${(n * (n - 1)) / 2} 次事件扫描`,
    "checkpoint(C=64)上界": `${Math.round((n * n) / (2 * C))} 次事件扫描`,
    perKind: JSON.stringify(perKind),
  }
  for (const k of opts.at ?? []) stats[`fs@seq${k}`] = JSON.stringify(snapshotAt(events, k).files)
  return { errors, warnings, stats }
}

export function snapshotAt(events: Ev[], upto: number): { files: Record<string, string>; order: string[] } {
  const map = new Map<string, string>()
  for (const e of events) {
    if (e.seq > upto) break
    if (e.kind === "fs_write") map.set(e.path, e.digest)
    else if (e.kind === "fs_delete") map.delete(e.path)
    else if (e.kind === "fs_move") {
      const d = map.get(e.from)
      map.delete(e.from)
      if (d) map.set(e.to, d)
    }
  }
  const files: Record<string, string> = {}
  const order: string[] = []
  for (const [p, d] of map) {
    files[p] = d.slice(0, 12)
    order.push(p)
  }
  return { files, order }
}
