import { describe, expect, test } from "bun:test"
import { recording } from "./recording.fixture"
import { snapshot, timeline } from "./timeline"

describe("recorded case projection", () => {
  test("each tool occupies one frame with its exact input and result", () => {
    const source = recording()
    const frames = timeline(source.messages)
    expect(frames).toHaveLength(7)
    expect(
      frames
        .flatMap((frame) => frame.parts)
        .filter((part) => part.type === "tool")
        .map((part) => part.id),
    ).toEqual([source.task.id, source.artifact.id, source.failure.id])
    expect(frames.some((frame) => frame.parts[0]?.type === "tool" && frame.parts[0].state.status === "pending")).toBe(
      false,
    )
    const result = snapshot(source.session, source.messages, frames, 2)
    expect(result.part.msg_002[0]).toEqual(source.task)
    const end = snapshot(source.session, source.messages, frames, frames.length)
    expect(end.part.msg_002.at(-1)).toMatchObject({ text: "Final answer" })
    expect(end.part.msg_002[1]).toEqual(source.artifact)
    expect(end.part.msg_004[0]).toEqual(source.failure)
  })

  test("seeking backwards removes later questions, artifacts, errors and summary diffs", () => {
    const source = recording()
    const frames = timeline(source.messages)
    const end = snapshot(source.session, source.messages, frames, frames.length)
    expect(end.message[source.session.id].at(-1)).toHaveProperty("error")
    expect(end.message[source.session.id][0]).toHaveProperty("summary.diffs")
    const initial = snapshot(source.session, source.messages, frames, 1)
    expect(initial.message[source.session.id]).toHaveLength(1)
    expect(initial.message[source.session.id][0]).toMatchObject({ summary: undefined })
    expect(Object.keys(initial.part)).toEqual(["msg_001"])
    expect(initial.permission).toEqual({})
    expect(initial.question).toEqual({})
    expect(initial.session_diff).toEqual({})
    expect(initial.session_status).toEqual({})
  })

  test("projected objects are isolated from the recording, including nested metadata", () => {
    const source = recording()
    const before = structuredClone(source)
    const frames = timeline(source.messages)
    const view = snapshot(source.session, source.messages, frames, frames.length)
    const part = view.part.msg_002[0]
    if (part.type !== "tool" || part.state.status !== "completed") throw new Error("Expected recorded tool result")
    part.state.input.description = "changed input"
    part.state.metadata.artifact = { kind: "changed metadata" }
    view.session[0].title = "changed by reconciliation"
    view.part.msg_002.splice(0)
    view.message[source.session.id].splice(0)
    expect(source).toEqual(before)
    expect(snapshot(source.session, source.messages, frames, frames.length).part.msg_002).toHaveLength(3)
  })

  test("deduplicates parts, omits lifecycle markers, and respects reverted history", () => {
    const source = recording()
    source.messages[1].parts.push({
      id: "prt_redacted",
      messageID: "msg_002",
      sessionID: source.session.id,
      type: "reasoning",
      text: "[REDACTED]",
      time: { start: 1, end: 2 },
    })
    source.messages[1].parts.push({ ...source.task, state: { ...source.task.state, input: { description: "latest" } } })
    const frames = timeline(source.messages, "msg_003")
    expect(frames).toHaveLength(4)
    const view = snapshot(source.session, source.messages, frames, 999)
    expect(view.message[source.session.id].map((message) => message.id)).toEqual(["msg_001", "msg_002"])
    expect(view.part.msg_002[0]).toHaveProperty("state.input.description", "latest")
  })

  test("empty sessions and histories larger than the live transcript page are supported", () => {
    const source = recording()
    expect(timeline([])).toEqual([])
    const messages = Array.from({ length: 450 }, (_, index) => ({
      info: { ...source.messages[0].info, id: `msg_${String(index).padStart(4, "0")}` },
      parts: [],
    }))
    const frames = timeline(messages)
    const view = snapshot(source.session, messages, frames, frames.length)
    expect(view.message[source.session.id]).toHaveLength(450)
    expect(view.message[source.session.id][0].id).toBe("msg_0000")
  })
})
