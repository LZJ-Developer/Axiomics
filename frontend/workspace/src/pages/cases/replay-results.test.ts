import { describe, expect, test } from "bun:test"
import type { Frame } from "./timeline"
import { replayArtifacts, replayFiles } from "./replay-results"

const saved = (id: string, version: number, path = `results/${id}.png`) => ({
  id,
  versionID: `ver_${id}_${version}`,
  version,
  size: 1024,
  sha256: "0".repeat(64),
  title: id,
  kind: "figure",
  path,
})

const artifact = (id: string, version = 1) => ({
  type: "tool",
  tool: "artifact",
  state: { status: "completed", metadata: { savedArtifact: saved(id, version) } },
})

const file = (tool: string, filePath: string, extra: Record<string, unknown> = {}) => ({
  type: "tool",
  tool,
  state: { status: "completed", input: { filePath, ...extra } },
})

// Only `parts` is read by the model under test, so the message envelope stays
// empty instead of rebuilding a full Message for every case.
const frame = (...parts: unknown[]): Frame => ({ parts } as unknown as Frame)

describe("replay results", () => {
  test("keeps the newest version of each saved artifact", () => {
    const frames = [frame(artifact("art_a", 1)), frame(artifact("art_a", 2)), frame(artifact("art_b"))]
    expect(replayArtifacts(frames).map((item) => `${item.id}@${item.version}`)).toEqual(["art_a@2", "art_b@1"])
  })

  test("a playhead that has not reached a result sees none of it", () => {
    const frames = [frame(file("read", "/projects/p/report.md")), frame(artifact("art_late"))]
    expect(replayArtifacts(frames.slice(0, 1))).toEqual([])
    expect(replayArtifacts(frames.slice(0, 2)).map((item) => item.id)).toEqual(["art_late"])
  })

  test("files carry the body a write or edit recorded, and reads only their path", () => {
    const frames = [
      frame(file("read", "/projects/p/work/notes.md")),
      frame(file("write", "/projects/p/work/notes.md", { content: "draft" })),
      frame(file("edit", "/projects/p/work/notes.md", { newString: "final" })),
      frame(file("write", "/projects/p/report/report.tex", { content: "\\section{x}" })),
    ]
    const files = replayFiles(frames, "/data/projects/prj_p")
    expect(files.map((item) => item.label)).toEqual(["work/notes.md", "report/report.tex"])
    // The edit is the last writer, so it wins over the earlier write.
    expect(files[0]).toMatchObject({ origin: "edit", content: "final" })
    expect(files[1]).toMatchObject({ origin: "write", content: "\\section{x}" })
  })

  test("a read after a write does not erase the recorded body", () => {
    const frames = [
      frame(file("write", "/projects/p/out.csv", { content: "a,b" })),
      frame(file("read", "/projects/p/out.csv")),
    ]
    expect(replayFiles(frames)[0]).toMatchObject({ origin: "write", content: "a,b" })
  })
})
