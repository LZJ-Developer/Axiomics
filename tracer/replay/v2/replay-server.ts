/**
 * M2 — read-only replay HTTP server (Hono).
 *
 * Truth lives on disk: <data>/<runId>.jsonl ledger + <data>/artifacts/<sha256> blobs.
 * Projection is done server-side by the M1 engine (checkpointed jump), so the
 * browser stays a dumb renderer. All routes are GET + read-only.
 */
import { Hono } from "hono"
import path from "node:path"
import { readdir } from "node:fs/promises"
import { buildCheckpoints, jump, project, summarize, type View } from "./engine"
import type { Checkpoints } from "./engine"
import { liveState } from "./livemode"
import type { Ev } from "./schema"

const DATA = path.join(import.meta.dir, "data")
const ART = path.join(DATA, "artifacts")
const PUBLIC = path.join(import.meta.dir, "public")

const cache = new Map<string, { events: Ev[]; cps: Checkpoints }>()
const inlineText = new Map<string, string>() // digest -> inline fs text found in ledgers

async function loadRun(id: string) {
  const hit = cache.get(id)
  if (hit) return hit
  const text = await Bun.file(path.join(DATA, `${id}.jsonl`)).text()
  const events = text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e?.kind) as Ev[]
  for (const e of events) if (e.kind === "fs_write" && e.text) inlineText.set(e.digest, e.text)
  const cps = buildCheckpoints(events, 64)
  cache.set(id, { events, cps })
  return { events, cps }
}

function viewJSON(v: View) {
  return {
    t: v.t,
    messages: v.messages,
    runs: v.runs,
    fs: [...v.fs], // [[path, digest], …]
    plots: v.plots,
    stateLabel: v.stateLabel,
    stateData: v.stateData,
    notes: v.notes,
  }
}

const app = new Hono()

app.get("/api/runs", async (c) => {
  const names = (await readdir(DATA)).filter((f) => f.endsWith(".jsonl") && f !== "sample-run.jsonl")
  const runs = []
  for (const n of names) {
    const id = n.replace(/\.jsonl$/, "")
    try {
      const { events } = await loadRun(id)
      const meta = events.find((e) => e.kind === "meta")
      const kinds: Record<string, number> = {}
      for (const e of events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1
      runs.push({
        id,
        events: events.length,
        kinds,
        goal: meta?.kind === "meta" ? meta.goal : undefined,
        model: meta?.kind === "meta" ? meta.model : undefined,
      })
    } catch (err) {
      runs.push({ id, error: String(err) })
    }
  }
  return c.json(runs)
})

app.get("/api/runs/:id/steps", async (c) => {
  const { events } = await loadRun(c.req.param("id"))
  const steps = events.map((e) => ({ seq: e.seq, kind: e.kind, ...summarize(e) }))
  return c.json(steps)
})

app.get("/api/runs/:id/view", async (c) => {
  const { events, cps } = await loadRun(c.req.param("id"))
  const t = Math.min(Math.max(Number(c.req.query("t") ?? events.length - 1), 0), events.length - 1)
  const v = events.length ? jump(events, t, cps) : project(events, 0)
  return c.json(viewJSON(v))
})

// live-mimic card stream at time t, honoring user-pinned cards
app.get("/api/runs/:id/live", async (c) => {
  const { events } = await loadRun(c.req.param("id"))
  const t = Math.min(Math.max(Number(c.req.query("t") ?? events.length - 1), 0), events.length - 1)
  const pinned = new Set((c.req.query("pinned") ?? "").split(",").filter(Boolean))
  const { view, newest } = liveState(events, t, pinned)
  return c.json({ t, newest, cards: view })
})

app.get("/api/runs/:id/events", async (c) => {
  const { events } = await loadRun(c.req.param("id"))
  const from = Number(c.req.query("from") ?? 0)
  const limit = Math.min(Number(c.req.query("limit") ?? 500), 2000)
  return c.json(events.slice(from, from + limit))
})

app.get("/artifacts/:digest", async (c) => {
  const digest = c.req.param("digest")
  const file = Bun.file(path.join(ART, digest))
  if (!(await file.exists())) return c.body("not found", 404)
  const mime = c.req.query("mime") ?? "application/octet-stream"
  return new Response(file, {
    headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable" },
  })
})

// text by digest: inline fs text from ledgers first, else artifact file as utf-8
app.get("/content/:digest", async (c) => {
  const digest = c.req.param("digest")
  const inline = inlineText.get(digest)
  if (inline !== undefined) return c.body(inline, 200, { "content-type": "text/plain; charset=utf-8" })
  const file = Bun.file(path.join(ART, digest))
  if (!(await file.exists())) return c.body("not found", 404)
  return c.body(await file.text(), 200, { "content-type": "text/plain; charset=utf-8" })
})

app.get("/player", async (c) => {
  const html = await Bun.file(path.join(PUBLIC, "index.html")).text()
  return c.html(html)
})
app.get("/", (c) => c.redirect("/player"))

const port = Number(process.env.PORT ?? 5177)
Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch })
console.log(`M2 replay server → http://127.0.0.1:${port}/player   (data=${DATA})`)
