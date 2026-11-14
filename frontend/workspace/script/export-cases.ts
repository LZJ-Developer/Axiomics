#!/usr/bin/env bun
/**
 * Export the eight curated showcase sessions into static replay fixtures.
 *
 *   bun script/export-cases.ts [data-root] [out-dir]
 *
 * `data-root` is a tenant data root (the directory containing `storage/`).
 * Defaults to the local multitenant deployment; `out-dir` defaults to
 * `public/cases/replay`. The export is read-only: it scans the session files,
 * sorts messages by creation time and parts by id, and writes one fixture per
 * case. Run this at release time so the public page and the workbench replay
 * read the same transcript.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { cases } from "../src/pages/cases/catalog"

const root = resolve(
  process.argv[2] ?? process.env.AXIOMICS_DATA_ROOT ?? "/disk1/dabiao/axiomics-mt/tenants/u0001/data",
)
const out = resolve(process.argv[3] ?? join(import.meta.dir, "../public/cases/replay"))
const storage = join(root, "storage")

const sessionRoot = join(storage, "session")
const messageRoot = join(storage, "message")
const partRoot = join(storage, "part")

if (!existsSync(sessionRoot)) {
  throw new Error(`no session storage under ${storage}`)
}

function findSession(sessionID: string) {
  for (const project of readdirSync(sessionRoot)) {
    const file = join(sessionRoot, project, `${sessionID}.json`)
    if (!existsSync(file)) continue
    return { project, file }
  }
  throw new Error(`session ${sessionID} not found under ${sessionRoot}`)
}

function read(file: string) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function parts(messageID: string) {
  const directory = join(partRoot, messageID)
  if (!existsSync(directory)) return []
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => read(join(directory, name)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

mkdirSync(out, { recursive: true })

for (const item of cases) {
  const found = findSession(item.sessionID)
  const session = read(found.file)
  const messages = readdirSync(join(messageRoot, item.sessionID))
    .filter((name) => name.endsWith(".json"))
    .map((name) => read(join(messageRoot, item.sessionID, name)))
    .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0) || String(a.id).localeCompare(String(b.id)))
  const recording = messages.map((message) => ({ info: message, parts: parts(message.id) }))
  const file = join(out, `${item.id}.json`)
  writeFileSync(file, JSON.stringify({ session, recording }), "utf8")
  const bytes = readFileSync(file).byteLength
  console.log(
    `${item.id.padEnd(24)} project=${found.project} messages=${messages.length} parts=${recording.reduce(
      (sum, entry) => sum + entry.parts.length,
      0,
    )} bytes=${bytes}`,
  )
}
