/**
 * Live-mimic card model.
 *
 * Reproduces the *product* UX shape on replay: agent messages are chat bubbles;
 * each tool execution becomes a run card that opens on tool_start and closes on
 * tool_end (canonical output kept as a lazy blob); each produced artifact
 * (plot/table) is its own card; fs/state/note become small cards. Scrubbing to
 * time t projects the card stream; exactly one card is "newest" (auto-open +
 * highlight) and everything else is collapsed unless the user pinned it open.
 *
 * Pure + deterministic so it can be unit-tested headless before the UI work.
 */
import type { Ev, Ref } from "./schema"

export type Card =
  | { id: string; at: number; type: "msg"; role: "agent" | "system"; text: string }
  | {
      id: string
      at: number
      type: "run"
      span: string
      tool: string
      status: "running" | "done"
      exit?: number
      durMs?: number
      out?: Ref
      err?: Ref
      lines: string[]
    }
  | { id: string; at: number; type: "artifact"; name: string; digest: string; mime: string; bytes: number }
  | { id: string; at: number; type: "fs"; text: string }
  | { id: string; at: number; type: "state"; label: string; data: unknown }
  | { id: string; at: number; type: "note"; sev: string; text: string }

export type CardView = Card & { state: "newest" | "open" | "collapsed" }

/** Project the visible card stream at time t (prefix events[0..t]). */
export function liveCards(events: Ev[], t: number): { cards: Card[]; newest: string | null } {
  const cards: Card[] = []
  const runs = new Map<string, { idx: number }>()
  let newest: string | null = null
  const hi = Math.min(t, events.length - 1)

  const upsertNewest = (id: string) => (newest = id)
  const push = (c: Card) => {
    cards.push(c)
    upsertNewest(c.id)
  }

  for (let i = 0; i <= hi; i++) {
    const e = events[i]
    switch (e.kind) {
      case "msg":
        push({ id: `msg:${e.seq}`, at: e.seq, type: "msg", role: e.role, text: e.text })
        break
      case "tool_start": {
        const run: Card = {
          id: `run:${e.span}`,
          at: e.seq,
          type: "run",
          span: e.span ?? "",
          tool: e.tool,
          status: "running",
          lines: [],
        }
        cards.push(run)
        runs.set(e.span ?? "", { idx: cards.length - 1 })
        upsertNewest(run.id)
        break
      }
      case "tool_out": {
        const r = runs.get(e.span ?? "")
        if (r) {
          const card = cards[r.idx] as Extract<Card, { type: "run" }>
          card.lines.push(e.text)
          card.at = e.seq
          upsertNewest(card.id)
        }
        break
      }
      case "tool_end": {
        const r = runs.get(e.span ?? "")
        if (r) {
          const card = cards[r.idx] as Extract<Card, { type: "run" }>
          card.status = "done"
          card.exit = e.exit
          card.durMs = e.durMs
          if (e.out) card.out = e.out
          if (e.err) card.err = e.err
          card.at = e.seq
          upsertNewest(card.id)
        }
        break
      }
      case "artifact":
        push({
          id: `art:${e.name}`,
          at: e.seq,
          type: "artifact",
          name: e.name,
          digest: e.digest,
          mime: e.mime,
          bytes: e.bytes,
        })
        break
      case "fs_write":
        push({ id: `fs:${e.path}:${e.seq}`, at: e.seq, type: "fs", text: `✎ ${e.path} (+${e.bytes}B)` })
        break
      case "fs_delete":
        push({ id: `fs:${e.path}:${e.seq}`, at: e.seq, type: "fs", text: `✖ ${e.path}` })
        break
      case "fs_move":
        push({ id: `fs:${e.from}:${e.seq}`, at: e.seq, type: "fs", text: `↦ ${e.from} → ${e.to}` })
        break
      case "state":
        push({ id: `state:${e.seq}`, at: e.seq, type: "state", label: e.label, data: e.data })
        break
      case "note":
        push({ id: `note:${e.seq}`, at: e.seq, type: "note", sev: e.sev, text: e.text })
        break
      case "meta":
        break
    }
  }
  return { cards, newest }
}

/** Apply collapse policy: newest auto-opens; pinned stay open; the rest collapse. */
export function liveState(events: Ev[], t: number, pinned: Set<string>): { view: CardView[]; newest: string | null } {
  const { cards, newest } = liveCards(events, t)
  const view: CardView[] = cards.map((c) => {
    let state: CardView["state"] = "collapsed"
    if (newest && c.id === newest) state = "newest"
    else if (pinned.has(c.id)) state = "open"
    return { ...c, state }
  })
  return { view, newest }
}
