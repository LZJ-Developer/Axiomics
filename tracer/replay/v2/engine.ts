/**
 * M1 — framework-agnostic projection engine (no DOM, no framework).
 *
 * Truth: append-only Ev[]. A "view" at time t is a projection of the prefix
 * events[0..t]. For scrubbing we keep O(n/C) immutable checkpoints and apply
 * the short suffix on jump, so forward/backward movement is O(1)..O(C), never
 * O(n) re-scan of the whole run per step.
 */
import type { Ev, Ref } from "./schema"

export type MsgView = { seq: number; role: "agent" | "system"; text: string }
export type RunView = {
  seq: number
  span: string
  tool: string
  cmd?: string
  exit: number
  durMs: number
  out?: Ref
  err?: Ref
}
export type PlotView = { seq: number; name: string; digest: string; mime: string; width?: number; height?: number }
export type NoteView = { seq: number; sev: "info" | "warn" | "error"; text: string }

export type View = {
  t: number
  messages: MsgView[]
  runs: RunView[]
  /** path -> digest. Full-content snapshots: content is fetched lazily by digest. */
  fs: Map<string, string>
  plots: PlotView[]
  stateLabel: string | null
  stateData: Record<string, unknown> | null
  notes: NoteView[]
}

export function emptyView(): View {
  return { t: -1, messages: [], runs: [], fs: new Map(), plots: [], stateLabel: null, stateData: null, notes: [] }
}

/** Mutating apply: pushes prefix events into a live view. Returns it. */
export function apply(v: View, e: Ev): View {
  v.t = e.seq
  switch (e.kind) {
    case "msg":
      v.messages.push({ seq: e.seq, role: e.role, text: e.text })
      break
    case "tool_start":
      break // runs are completed by tool_end (canonical full output)
    case "tool_end":
      v.runs.push({
        seq: e.seq,
        span: e.span ?? "",
        tool: e.span ?? "?",
        cmd: undefined,
        exit: e.exit,
        durMs: e.durMs,
        out: e.out,
        err: e.err,
      })
      break
    case "fs_write":
      v.fs.set(e.path, e.digest)
      break
    case "fs_delete":
      v.fs.delete(e.path)
      break
    case "fs_move":
      {
        const d = v.fs.get(e.from)
        v.fs.delete(e.from)
        if (d) v.fs.set(e.to, d)
      }
      break
    case "plot":
      // plot arrives as `artifact` in v2; kept for v1 compat if used
      break
    case "artifact":
      v.plots.push({ seq: e.seq, name: e.name, digest: e.digest, mime: e.mime, width: e.width, height: e.height })
      break
    case "state":
      v.stateLabel = e.label
      v.stateData = e.data
      break
    case "note":
      v.notes.push({ seq: e.seq, sev: e.sev, text: e.text })
      break
    case "meta":
      break
  }
  return v
}

/** Immutable copy so stored checkpoints never alias later mutations. */
export function copyView(v: View): View {
  return {
    t: v.t,
    messages: v.messages.slice(),
    runs: v.runs.slice(),
    fs: new Map(v.fs),
    plots: v.plots.slice(),
    stateLabel: v.stateLabel,
    stateData: v.stateData ? { ...v.stateData } : null,
    notes: v.notes.slice(),
  }
}

/** Full projection of events[0..t]. */
export function project(events: Ev[], t: number): View {
  const v = emptyView()
  const hi = Math.min(t, events.length - 1)
  for (let i = 0; i <= hi; i++) apply(v, events[i])
  return v
}

export type Checkpoints = { C: number; points: { end: number; view: View }[] }

/** Build incremental checkpoints every C events. */
export function buildCheckpoints(events: Ev[], C = 64): Checkpoints {
  const points: { end: number; view: View }[] = []
  const live = emptyView()
  for (let i = 0; i < events.length; i++) {
    apply(live, events[i])
    if ((i + 1) % C === 0 || i === events.length - 1) points.push({ end: i, view: copyView(live) })
  }
  return { C, points }
}

/** Jump to time t: nearest checkpoint ≤ t, then apply the short suffix. */
export function jump(events: Ev[], t: number, cps: Checkpoints): View {
  const hi = Math.min(t, events.length - 1)
  const p = cps.points.findLast((pt) => pt.end <= hi)
  const base = p ? copyView(p.view) : emptyView()
  for (let i = p ? p.end + 1 : 0; i <= hi; i++) apply(base, events[i])
  return base
}

/** One-line summary per event — used for the (default-collapsed) step list. */
export function summarize(e: Ev): { tag: string; text: string } {
  switch (e.kind) {
    case "meta":
      return { tag: "meta", text: e.model }
    case "msg":
      return { tag: "agent", text: e.text }
    case "tool_start":
      return { tag: "tool", text: `${e.tool} ${e.cmd ?? JSON.stringify(e.args ?? {}).slice(0, 60)}` }
    case "tool_out":
      return { tag: "out", text: e.text.replace(/\s+/g, " ").slice(0, 80) }
    case "tool_end":
      return { tag: "done", text: `exit=${e.exit} ${e.durMs}ms out=${e.out?.bytes ?? 0}B` }
    case "fs_write":
      return { tag: "fs+", text: `${e.path} (${e.bytes}B)` }
    case "fs_delete":
      return { tag: "fs-", text: e.path }
    case "fs_move":
      return { tag: "fs→", text: `${e.from} → ${e.to}` }
    case "artifact":
      return { tag: "plot", text: `${e.name} (${e.mime}, ${e.bytes}B)` }
    case "state":
      return { tag: "state", text: e.label }
    case "note":
      return { tag: e.sev, text: e.text }
  }
}
