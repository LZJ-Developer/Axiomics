/**
 * Event model v2 — the object under validation.
 *
 * Design decisions (see discussion):
 *  - small events live in the JSONL ledger; big payloads are content-addressed
 *    Ref { digest = sha256, bytes, mime } blobs fetched lazily.
 *  - fs events are recorded ONLY for tracked, human-inspectable text files
 *    (code/markdown/config). Binary omics data goes through `artifact` refs,
 *    never as fs content. We store full-content snapshots (digest-addressed),
 *    so "filesystem at time t" = per-path latest digest with seq <= t.
 *  - global total order by a single monotonic `seq` stamped by the session
 *    writer (never wall clock); concurrent tool I/O is grouped by `span`.
 *  - inline text is capped (INLINE_MAX) — above that it must be a Ref.
 */
import { createHash } from "node:crypto"

export const INLINE_MAX = 2048
/** Paths the fs-replay layer ignores entirely (mirrors .gitignore + heavy data). */
export const IGNORE_RE =
  /(^|\/)(node_modules|\.git|__pycache__|\.venv|\.cache|\.axiomics)(\/|$)|\.(h5|h5ad|hdf5|bam|cram|bcf|npy|npz|zarr|tmp|cache|pyc|o|so)$/i

export function isIgnored(path: string): boolean {
  return IGNORE_RE.test(path)
}

export type Ref = { digest: string; bytes: number; mime?: string }
type Base = { seq: number; wall: number; span?: string }

export type Ev =
  | (Base & { kind: "meta"; goal: string; model: string })
  | (Base & { kind: "msg"; role: "agent" | "system"; text: string })
  | (Base & { kind: "tool_start"; tool: string; cmd?: string; args?: Record<string, unknown> })
  | (Base & { kind: "tool_out"; text: string }) // small incremental stdout
  | (Base & { kind: "tool_end"; exit: number; durMs: number; out?: Ref; err?: Ref })
  | (Base & { kind: "fs_write"; path: string; digest: string; bytes: number; prev?: string | null; text?: string })
  | (Base & { kind: "fs_delete"; path: string })
  | (Base & { kind: "fs_move"; from: string; to: string })
  | (Base & {
      kind: "artifact"
      name: string
      digest: string
      mime: string
      bytes: number
      width?: number
      height?: number
    })
  | (Base & { kind: "state"; label: string; data: Record<string, unknown> })
  | (Base & { kind: "note"; sev: "info" | "warn" | "error"; text: string })

export const HEX64 = /^[a-f0-9]{64}$/

export function digestOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}
