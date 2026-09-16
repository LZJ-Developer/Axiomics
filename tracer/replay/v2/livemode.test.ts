import { test, expect } from "bun:test"
import path from "node:path"
import { buildRunV2 } from "./fixture-v2"
import { liveState, liveCards } from "./livemode"
import type { Ev } from "./schema"

const H2 = import.meta.dir

test("live 模型：每时点至多一个 newest；无 pin 时可见卡片恰一个 newest", () => {
  const evs = buildRunV2().events
  for (let t = 0; t < evs.length; t++) {
    const { view, newest } = liveState(evs, t, new Set())
    const newCount = view.filter((c) => c.state === "newest").length
    expect(newCount).toBeLessThanOrEqual(1)
    if (view.length && newest) expect(newCount).toBe(1)
    // 无 pin 时其余全 collapsed
    for (const c of view) {
      if (c.state !== "newest") expect(c.state).toBe("collapsed")
    }
  }
})

test("live 模型：real-run 全程不变式 + 终结状态正确", async () => {
  const ledger = await Bun.file(path.join(H2, "data", "real-run.jsonl")).text()
  const evs: Ev[] = ledger
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  for (let t = 0; t < evs.length; t++) {
    const { view, newest } = liveState(evs, t, new Set())
    const n = view.filter((c) => c.state === "newest").length
    expect(n).toBeLessThanOrEqual(1)
    if (view.length && newest) expect(n).toBe(1)
    expect(view.filter((c) => c.state === "collapsed" || c.state === "newest" || c.state === "open").length).toBe(
      view.length,
    )
  }
  const end = liveState(evs, evs.length - 1, new Set())
  const runs = end.view.filter((c): c is Extract<(typeof end.view)[number], { type: "run" }> => c.type === "run")
  expect(runs.map((r) => r.exit)).toEqual([0, 3])
  // 不变式：view 中最后一个可见卡片 = newest（高亮）
  const last = end.view[end.view.length - 1]
  expect(last?.state).toBe("newest")
  expect(end.newest).toBe(last?.id ?? null)
})

test("live 模型：确定性（同 t 两次结果相同）", () => {
  const evs = buildRunV2().events
  const a = liveState(evs, evs.length - 1, new Set(["msg:0"]))
  const b = liveState(evs, evs.length - 1, new Set(["msg:0"]))
  expect(JSON.stringify(a)).toBe(JSON.stringify(b))
})

test("live 模型：手动 pin 覆盖自动折叠；回溯不丢", () => {
  const evs = buildRunV2().events
  // pin 早期 msg (fixture 首条 agent 消息 seq=1)
  const pinned = new Set(["msg:1"])
  const s5 = liveState(evs, 5, pinned)
  const msgCard = s5.view.find((c) => c.id === "msg:1")
  expect(msgCard?.state).toBe("open") // pin 保住，即使不是 newest
  // 到末尾仍 open
  const end = liveState(evs, evs.length - 1, pinned)
  expect(end.view.find((c) => c.id === "msg:1")?.state).toBe("open")
  // 事件顺序: fs 前、tool 分组不重(单 span 单 run 卡)
  const all = liveCards(evs, evs.length - 1)
  const runIds = all.cards.filter((c) => c.type === "run").map((c) => c.id)
  expect(new Set(runIds).size).toBe(runIds.length) // 无重复 run 卡
  const artCount = all.cards.filter((c) => c.type === "artifact").length
  expect(artCount).toBe(2)
})

test("live 模型：新产物成为 newest 时旧的自动折叠（collapse 语义）", () => {
  const evs = buildRunV2().events
  const tArt = evs.findIndex((e) => e.kind === "artifact") // 第一张图产生处
  const before = liveState(evs, tArt - 1, new Set())
  const at = liveState(evs, tArt, new Set())
  // 图到达的那刻，图是 newest
  expect(at.newest?.startsWith("art:")).toBe(true)
  // 图之后再来 fs_write，图退为 collapsed（无 pin）
  const tFs = evs.findIndex((e, i) => i > tArt && e.kind === "fs_write")
  const after = liveState(evs, tFs, new Set())
  expect(after.view.find((c) => c.id === at.newest)?.state).toBe("collapsed")
})
