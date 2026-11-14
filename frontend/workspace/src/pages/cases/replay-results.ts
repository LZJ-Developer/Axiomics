import { generatedArtifacts, type SavedArtifact } from "@axiomics/ui/tool-display"
import type { Frame } from "./timeline"

/**
 * The public replay owns no tenant API, so the inspector reads the workspace
 * state the recording already carries: saved artifacts live on the `artifact`
 * tool's metadata, and edited files live in the write/edit inputs. Both shapes
 * are exactly what the live session stored, so the panel describes the same
 * results the original analyst saw — without a server.
 */

export function replayArtifacts(frames: readonly Frame[]): SavedArtifact[] {
  return generatedArtifacts(frames.flatMap((frame) => frame.parts))
}

export type ReplayFile = {
  path: string
  label: string
  content?: string
  origin: "write" | "edit" | "read"
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function input(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

/** Recorded paths are absolute on the machine that produced them; the export
 * either rewrites that root to `/data/projects/<id>` or leaves the host's
 * `…/projects/<folder>` in place. Both anchor on a `projects` segment followed
 * by the project folder, so the inspector can show the same project-relative
 * paths artifacts use (`report/report.tex`). */
export function replayPath(path: string, directory?: string) {
  const normal = path.replaceAll("\\", "/")
  if (directory) {
    const root = directory.replaceAll("\\", "/").replace(/\/$/, "")
    if (normal === root) return normal.split("/").pop() ?? normal
    if (normal.startsWith(`${root}/`)) return normal.slice(root.length + 1)
  }
  const marker = normal.search(/(?:^|\/)[^/]*projects\//)
  if (marker === -1) return normal.replace(/^\/+/, "")
  const rest = normal.slice(marker).replace(/^\/?[^/]*projects\//, "")
  const slash = rest.indexOf("/")
  return slash === -1 ? rest : rest.slice(slash + 1)
}

export function replayFiles(frames: readonly Frame[], directory?: string): ReplayFile[] {
  const order: string[] = []
  const files = new Map<string, ReplayFile>()
  for (const frame of frames) {
    for (const part of frame.parts) {
      if (part.type !== "tool") continue
      const tool = (part as { tool?: string }).tool
      if (tool !== "write" && tool !== "edit" && tool !== "read") continue
      const state = (part as { state?: { input?: unknown } }).state
      const value = input(state?.input)
      const path = text(value?.filePath)
      if (!path) continue
      const key = path.replaceAll("\\", "/")
      const next: ReplayFile = {
        path: key,
        label: replayPath(key, directory),
        origin: tool,
      }
      if (tool === "write") next.content = text(value?.content)
      if (tool === "edit") next.content = text(value?.newString)
      const current = files.get(key)
      if (!current) order.push(key)
      // A later read must not erase the body a write recorded earlier.
      if (!current || next.content !== undefined) files.set(key, next)
    }
  }
  return order.map((key) => files.get(key)!)
}
