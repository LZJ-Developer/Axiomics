/** Persist v2 fixture (ledger + blobs) and run the model validator + fault drills. */
import { buildRunV2 } from "./fixture-v2"
import { snapshotAt, validate } from "./validate"
import type { Ev } from "./schema"

const LEDGER = "./data/run-v2.jsonl"
const ART = "./data/artifacts"
const { events, blobs } = buildRunV2()
await Bun.write(LEDGER, events.map((e) => JSON.stringify(e)).join("\n") + "\n")
let written = 0
for (const [digest, content] of blobs) {
  await Bun.write(`${ART}/${digest}`, content)
  written++
}

const have = (d: string) => blobs.has(d)
const R = validate(events, have, { at: [] })

console.log("── v2 模型校验 ────────────────────────────────")
console.log(
  `events=${events.length}  ledgerBytes=${R.stats.ledgerBytes}  refBytes=${R.stats.refBytes}  blobs=${written}(磁盘)`,
)
console.log(`errors=${R.errors.length}  warnings=${R.warnings.length}`)
for (const e of R.errors.slice(0, 20)) console.log("  ERR:", e)
for (const w of R.warnings) console.log("  warn:", w)
console.log("  perKind:", R.stats.perKind)
console.log(
  "  朴素全扫 vs checkpoint(C=64):",
  R.stats["朴素全扫(拖整条时间轴估算)"],
  "|",
  R.stats["checkpoint(C=64)上界"],
)

// time-travel probe: show which version of run_qc.py exists at chosen moments
function contentAt(k: number, path: string): string | undefined {
  let hit: string | undefined
  for (const e of events) {
    if (e.seq > k) break
    if (e.kind === "fs_write" && e.path === path && e.text !== undefined) hit = e.text
    if (e.kind === "fs_delete" && e.path === path) hit = undefined
  }
  return hit
}
const vIdx = (marker: string) =>
  events.findIndex((e) => e.kind === "fs_write" && e.path === "scripts/run_qc.py" && e.text?.includes(marker))
const marks: Array<[string, number]> = [
  ["写完 v1(QC)", vIdx("# v1")],
  ["写完 v2(norm+PCA)", vIdx("# v2")],
  ["写完 v3(UMAP)", vIdx("# v3")],
]
console.log("\n── 时间旅行探测 (scripts/run_qc.py) ──")
for (const [label, k] of marks) {
  const c = contentAt(k, "scripts/run_qc.py")
  const ver = c?.includes("# v3")
    ? "v3(UMAP)"
    : c?.includes("# v2")
      ? "v2(norm+PCA)"
      : c?.includes("# v1")
        ? "v1(QC)"
        : "无"
  console.log(`  seq<=${k} ${label} → ${ver}`)
}
const fin = snapshotAt(events, events.length - 1)
console.log(`\n最终文件树(${fin.order.length}): ${fin.order.join("  ·  ")}`)

// ---- fault drills: the validator must catch injected corruption ----
function drill(name: string, evs: Ev[], mutate: (a: Ev[]) => void) {
  const clone = structuredClone(evs)
  mutate(clone)
  const r = validate(clone, have, {})
  console.log(`\n── 故障演练: ${name} → 捕获错误 ${r.errors.length} 条`)
  for (const e of r.errors.slice(0, 4)) console.log("   ✓ 检出:", e)
}
drill("序号破坏(把 seq#3 改成 999)", events, (a) => {
  a[3].seq = 999
})
drill("破坏 prev 链(最后一次 run_qc.py 重写 prev 置 null)", events, (a) => {
  const last = [...a].reverse().find((e) => e.kind === "fs_write" && e.path === "scripts/run_qc.py")!
  ;(last as Extract<Ev, { kind: "fs_write" }>).prev = null
})
drill("span 失衡(s3 的 tool_end 拼成 s1)", events, (a) => {
  const te = a.find((e) => e.kind === "tool_end" && e.span === "s3")!
  ;(te as Extract<Ev, { kind: "tool_end" }>).span = "s1"
})
drill("写入被 ignore 的路径(data/foo.h5ad)", events, (a) => {
  a.push({
    seq: a.length,
    wall: 0,
    kind: "fs_write",
    path: "data/foo.h5ad",
    digest: "a".repeat(64),
    bytes: 1,
    prev: null,
  } as Ev)
})

const clean = R.errors.length === 0
console.log(clean ? "\n✅ v2 模型：clean fixture 全部不变式通过" : "\n❌ clean fixture 竟有错误，需修")
process.exit(clean ? 0 : 1)
