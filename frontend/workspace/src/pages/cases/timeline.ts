import type { Message, Part, Session } from "@axiomics/sdk/v2"
import { reasoningDisplayText, reasoningTopic } from "@axiomics/ui/tool-display"

export type Recording = { info: Message; parts: Part[] }[]
export type Frame = { info: Message; parts: Part[]; turn: string; done?: boolean }

/** Each saved part is one replay frame. Tool renderers receive the recorded
 * input and result together, as they do when viewing a completed session. */
export function timeline(recording: Recording, revert?: string) {
  const frames: Frame[] = []
  const users = new Set(recording.filter((item) => item.info.role === "user").map((item) => item.info.id))
  for (const item of recording) {
    if (revert && item.info.id >= revert) continue
    if (item.info.role === "user") {
      frames.push({ info: { ...item.info, summary: undefined }, parts: item.parts, turn: item.info.id })
      continue
    }
    if (!users.has(item.info.parentID) || (revert && item.info.parentID >= revert)) continue
    const info = { ...item.info, error: undefined, finish: undefined }
    const parts = new Map(item.parts.map((part) => [part.id, part]))
    const entries: Frame[] = []
    for (const part of parts.values()) {
      if (part.type === "text" && !part.text.trim()) continue
      if (part.type === "reasoning" && !reasoningDisplayText(part.text) && !reasoningTopic(part.text)) continue
      if (part.type === "tool" && part.tool === "todoread") continue
      if (part.type !== "text" && part.type !== "reasoning" && part.type !== "tool") continue
      entries.push({ info, parts: [part], turn: info.parentID })
    }
    // Provider errors can be recorded without a text/tool part.
    if (item.info.error) entries.push({ info: item.info, parts: [], turn: info.parentID })
    const last = entries.at(-1)
    if (last) last.info = item.info
    frames.push(...entries)
  }
  // Restore end-of-turn metadata only when all of that turn's frames are visible.
  const last = new Map(frames.map((frame) => [frame.turn, frame]))
  for (const frame of last.values()) frame.done = true
  return frames
}

/** Build an isolated provider store; seeking never writes to the live sync cache. */
export function snapshot(session: Session, recording: Recording, frames: Frame[], cursor: number) {
  const messages = new Map<string, Message>()
  const parts = new Map<string, Map<string, Part>>()
  const complete = new Set<string>()
  for (const frame of frames.slice(0, Math.max(0, Math.min(cursor, frames.length)))) {
    messages.set(frame.info.id, frame.info)
    const values = parts.get(frame.info.id) ?? new Map<string, Part>()
    for (const part of frame.parts) values.set(part.id, part)
    parts.set(frame.info.id, values)
    if (frame.done) complete.add(frame.turn)
  }
  for (const item of recording) {
    if (item.info.role === "user" && complete.has(item.info.id)) messages.set(item.info.id, item.info)
  }
  // Solid's reconciliation mutates its backing objects. Keep those objects
  // separate from the saved recording so backward seeks remain reversible.
  return structuredClone({
    session: [session],
    session_status: {},
    session_diff: {},
    permission: {},
    question: {},
    message: { [session.id]: [...messages.values()] },
    part: Object.fromEntries([...parts].map(([id, values]) => [id, [...values.values()]])),
  })
}
