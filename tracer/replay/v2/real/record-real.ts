/**
 * (a) Real-execution recorder drill.
 * Runs REAL shell commands (streaming stdout + a real file write; then a failing
 * command), records them as v2 events, and runs the model validator. The point is
 * to expose modeling gaps that synthetic fixtures hide.
 */
import path from "node:path"
import { readdir, mkdir, rm, stat, readFile, writeFile } from "node:fs/promises"
import { digestOf, isIgnored, type Ev, type Ref } from "../schema"
import { validate } from "../validate"

const HERE = import.meta.dir
const V2 = path.resolve(HERE, "..")
const WORK = path.join(HERE, "work")
const LEDGER = path.join(V2, "data", "real-run.jsonl")
const ART = path.join(V2, "data", "artifacts")

const events: Ev[] = []
const blobs = new Map<string, string>()
let seq = 0
const W0 = Date.now()
const emit = (e: Omit<Ev, "seq" | "wall">) => events.push({ ...e, seq: seq++, wall: Date.now() - W0 } as Ev)
const addBlob = (content: string): Ref => {
  const digest = digestOf(content)
  blobs.set(digest, content)
  return { digest, bytes: Buffer.byteLength(content, "utf8") }
}

// tracked-file snapshot of WORK: rel path -> digest of text content
async function hashWork(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  async function walk(dir: string, rel = "") {
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name)
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (isIgnored(r)) continue
      if (ent.isDirectory()) await walk(p, r)
      else if (ent.isFile()) {
        const st = await stat(p)
        if (st.size > 200_000) continue // don't fs-track big files
        out.set(r, digestOf(await readFile(p, "utf8")))
      }
    }
  }
  await walk(WORK)
  return out
}

async function runAndCapture(shell: string, label: string): Promise<{ chunks: string[]; exit: number; durMs: number }> {
  emit({ kind: "tool_start", span: label, tool: "bash", cmd: shell })
  const started = Date.now()
  const proc = Bun.spawn(["/bin/bash", "-c", shell], { cwd: WORK, stdout: "pipe", stderr: "pipe" })
  const dec = new TextDecoder()
  const decErr = new TextDecoder()
  const chunks: string[] = []
  let errFull = ""
  const drainErr = (async () => {
    for await (const c of proc.stderr) errFull += decErr.decode(c, { stream: true })
  })()
  for await (const c of proc.stdout) {
    const t = dec.decode(c, { stream: true })
    chunks.push(t)
    emit({ kind: "tool_out", span: label, text: t.slice(0, 400) }) // live deltas (throttled size)
  }
  await drainErr
  const exit = await proc.exited
  const durMs = Date.now() - started
  const full = chunks.join("")
  if (full)
    emit({
      kind: "tool_end",
      span: label,
      exit,
      durMs,
      out: addBlob(full),
      err: errFull ? addBlob(errFull) : undefined,
    })
  else emit({ kind: "tool_end", span: label, exit, durMs, err: errFull ? addBlob(errFull) : undefined })
  if (errFull) emit({ kind: "note", sev: exit === 0 ? "info" : "error", text: `stderr: ${errFull.slice(0, 120)}` })
  return { chunks, exit, durMs }
}

await rm(WORK, { recursive: true, force: true })
await mkdir(WORK, { recursive: true })
await mkdir(path.join(WORK, "out"), { recursive: true })

emit({ kind: "meta", goal: "real-run drill: bash 写 CSV + 失败命令", model: "none (bash)" })
const before = await hashWork()

// --- real success command: streams progress AND writes out/real_matrix.csv
await runAndCapture(
  `for i in 1 2 3 4 5 6; do echo "step $i: cells=6281 pca_ok=1"; sleep 0.2; done
printf 'gene,mean\nGAPDH,12.3\nCD3D,4.1\n' > out/real_matrix.csv
echo 'wrote out/real_matrix.csv'`,
  "s-real-ok",
)

// --- real failing command: nonzero exit
await runAndCapture(`echo 'reading missing.sra'; echo 'ERROR: no such file' >&2; exit 3`, "s-real-fail")

// fs diff -> fs_write/fs_delete for tracked text that really changed
const after = await hashWork()
for (const [p, d] of after) {
  if (!before.has(p) || before.get(p) !== d) {
    const content = await readFile(path.join(WORK, p), "utf8")
    const b = Buffer.byteLength(content, "utf8")
    if (b <= 2048)
      emit({
        kind: "fs_write",
        path: `work/${p}`,
        digest: digestOf(content),
        bytes: b,
        prev: before.get(p) ?? null,
        text: content,
      })
    else emit({ kind: "fs_write", path: `work/${p}`, digest: d, bytes: b, prev: before.get(p) ?? null })
  }
}
for (const [p] of before) if (!after.has(p)) emit({ kind: "fs_delete", path: `work/${p}` })
emit({ kind: "state", label: "after-real", data: { spans: 2, exit_ok: 0, exit_fail: 3 } })

// persist ledger + blobs, then validate
await writeFile(LEDGER, events.map((e) => JSON.stringify(e)).join("\n") + "\n")
await mkdir(ART, { recursive: true })
for (const [d, c] of blobs) await writeFile(path.join(ART, d), c)

const R = validate(events, (d) => blobs.has(d), {})
console.log(`\n── (a) 真实录制 drill ──`)
console.log(
  `events=${events.length}  ledger=${JSON.stringify(events).length}B  blobs=${blobs.size}  命令耗时: 见 tool_end.durMs`,
)
console.log(`errors=${R.errors.length}  warnings=${R.warnings.length}`)
for (const e of R.errors.slice(0, 12)) console.log("  ERR:", e)
for (const w of R.warnings.slice(0, 12)) console.log("  warn:", w)
const ends = events.filter((e) => e.kind === "tool_end") as Extract<Ev, { kind: "tool_end" }>[]
for (const e of ends)
  console.log(
    `  tool_end ${e.span}: exit=${e.exit} dur=${e.durMs}ms out=${e.out?.bytes ?? "-"}B err=${e.err?.bytes ?? "-"}B`,
  )
console.log(
  `真实产物 fs_write: ${
    events
      .filter((e) => e.kind === "fs_write")
      .map((e) => (e as Extract<Ev, { kind: "fs_write" }>).path)
      .join(", ") || "无"
  }`,
)

// --- real-model discoveries surfaced by this drill (asserted as human notes) ---
console.log("\n── REAL-DISCOVERY（真实现场暴露，需模型决策）──")
console.log(
  "1. tool_out 增量来自任意 chunk 边界，不一定是整行 → live 层应按文本增量；回放用 tool_end.out(全量 blob) 即可还原终端。",
)
console.log(
  "2. stdout 全量 blob 与 tool_out 增量在账本里并存 → 若两者都持久化会重复计体积；建议 tool_out 仅 live（可选丢弃），tool_end.out 为唯一 canonical。",
)
console.log(
  "3. 失败命令 stderr 进了 note，同时 tool_end.err blob → 两条路径冗余；需约定：note 只在人类结论，err 细节走 blob。",
)
console.log(
  `4. fs 变化是命令结束后才 diff 出来的（非实时）→ 实时文件树要靠进程内 watch 或 agent 的显式 write 事件；bash 黑盒只能事后 diff。`,
)
