import { test, expect } from "bun:test"
import path from "node:path"
import { buildRunV2 } from "./fixture-v2"
import { apply, buildCheckpoints, copyView, jump, project, summarize } from "./engine"
import { digestOf, type Ev } from "./schema"

const H2 = import.meta.dir

function eq(a: ReturnType<typeof project>, b: ReturnType<typeof project>): boolean {
  return (
    a.t === b.t &&
    JSON.stringify(a.messages) === JSON.stringify(b.messages) &&
    JSON.stringify(a.runs) === JSON.stringify(b.runs) &&
    JSON.stringify([...a.fs].sort()) === JSON.stringify([...b.fs].sort()) &&
    JSON.stringify(a.plots) === JSON.stringify(b.plots) &&
    a.stateLabel === b.stateLabel &&
    JSON.stringify(a.stateData) === JSON.stringify(b.stateData) &&
    JSON.stringify(a.notes) === JSON.stringify(b.notes)
  )
}

test("M1: v2 fixture 投影到最终状态（runs/plots/fs/state）", () => {
  const evs = buildRunV2().events
  const v = project(evs, evs.length - 1)
  expect(v.messages.length).toBeGreaterThanOrEqual(3)
  expect(v.runs.length).toBe(3) // s1,s2,s3
  expect(v.plots.length).toBe(2)
  expect(v.stateLabel).toBe("final")
  const files = [...v.fs.keys()]
  expect(files).toContain("scripts/run_qc.py")
  expect(files).toContain("notes/result.md")
  expect(files).toContain("out/matrix_summary.csv")
  expect(files).toContain("scripts/plotting.py") // move 生效
  expect(files).not.toContain("scripts/legacy_plot.py")
  expect(files).not.toContain("notes/scratch.md") // delete 生效
  expect(v.runs.map((r) => r.exit)).toEqual([0, 0, 0])
})

test("M1: 时间旅行——run_qc.py 在 v1/v2/v3 时刻 digest 递进", () => {
  const evs = buildRunV2().events
  const atVer = (marker: string) =>
    evs.findIndex((e) => e.kind === "fs_write" && e.path === "scripts/run_qc.py" && e.text?.includes(marker))
  const d1 = project(evs, atVer("# v1")).fs.get("scripts/run_qc.py")!
  const d2 = project(evs, atVer("# v2")).fs.get("scripts/run_qc.py")!
  const d3 = project(evs, atVer("# v3")).fs.get("scripts/run_qc.py")!
  expect(project(evs, 2).fs.has("scripts/run_qc.py")).toBe(false) // 尚未写入
  expect([d1, d2, d3].every(Boolean)).toBe(true)
  expect(new Set([d1, d2, d3]).size).toBe(3)
  expect(project(evs, evs.length - 1).fs.get("scripts/run_qc.py")).toBe(d3) // 同内容重写不改变
})

test("M1: jump == 全量重投影 (fixture, C=4)", () => {
  const evs = buildRunV2().events
  const cps = buildCheckpoints(evs, 4)
  for (const t of [0, 3, 7, 13, 21, evs.length - 1]) {
    expect(eq(project(evs, t), jump(evs, t, cps))).toBe(true)
  }
  expect(cps.points.length).toBe(Math.ceil(evs.length / 4))
})

function synthRun(n: number): Ev[] {
  const evs: Ev[] = []
  for (let i = 0; i < n; i++) {
    const kind = i % 6
    const base = { seq: i, wall: i }
    if (kind === 0) evs.push({ ...base, kind: "msg", role: "agent", text: `m${i}` })
    else if (kind === 1) evs.push({ ...base, kind: "tool_start", span: `s${i}`, tool: "bash" })
    else if (kind === 2)
      evs.push({
        ...base,
        kind: "tool_end",
        span: `s${i}`,
        exit: i % 3,
        durMs: 10,
        out: { digest: digestOf(`o${i}`), bytes: 4 },
      })
    else if (kind === 3)
      evs.push({
        ...base,
        kind: "fs_write",
        path: `f${i % 8}.txt`,
        digest: digestOf(`c${i % 5}`),
        bytes: 1,
        prev: null,
        text: `c${i % 5}`,
      })
    else if (kind === 4) evs.push({ ...base, kind: "state", label: `st${i}`, data: { i } })
    else evs.push({ ...base, kind: "note", sev: "info", text: `n${i}` })
  }
  return evs
}

test("M1: 合成 200 事件、C=32（多检查点）jump==重投影", () => {
  const evs = synthRun(200)
  const cps = buildCheckpoints(evs, 32)
  expect(cps.points.length).toBe(Math.ceil(200 / 32))
  for (const t of [0, 31, 32, 63, 100, 199]) {
    expect(eq(project(evs, t), jump(evs, t, cps))).toBe(true)
  }
})

test("M1: 真实录制 drill 数据加载并投影（bash ok + fail）", async () => {
  const ledger = await Bun.file(path.join(H2, "data", "real-run.jsonl")).text()
  const events: Ev[] = ledger
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  const v = project(events, events.length - 1)
  expect(v.runs.length).toBe(2)
  expect(v.runs.map((r) => r.exit)).toEqual([0, 3])
  expect(v.fs.has("work/out/real_matrix.csv")).toBe(true)
  const ok = v.runs.find((r) => r.exit === 0)!.out!
  const ART = path.join(H2, "data", "artifacts")
  const text = new TextDecoder().decode(await Bun.file(path.join(ART, ok.digest)).arrayBuffer())
  expect(text.startsWith("step 1")).toBe(true)
})

test("M1: summarize 覆盖所有 kind 不崩溃", () => {
  for (const e of buildRunV2().events) expect(typeof summarize(e).text).toBe("string")
  for (const e of synthRun(24)) expect(summarize(e).tag.length).toBeGreaterThan(0)
})

test("M1: copyView 隔离——apply 到 live 视图不污染检查点", () => {
  const evs = buildRunV2().events
  const p = project(evs, 4)
  const snap = copyView(p)
  apply(p, evs[5]) // mutate live
  expect(eq(snap, project(evs, 4))).toBe(true) // 快照仍等于 4 时刻
  expect(eq(p, project(evs, 5))).toBe(true) // live 前进到 5
})
