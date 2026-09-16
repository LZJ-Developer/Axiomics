import { expect, test } from "bun:test"
import type { ToolPart } from "@axiomics/sdk/v2"
import { artifactRank, bestArtifact, framePdf } from "./artifacts"
import type { Frame } from "./timeline"

function frame(input: {
  id: string
  title: string
  path: string
  kind: string
  mimeType: string
  version?: number
}): Frame {
  const version = input.version ?? 1
  const part: ToolPart = {
    id: `part_${input.id}_${version}`,
    messageID: "msg_assistant",
    sessionID: "ses_replay",
    type: "tool",
    callID: `call_${input.id}_${version}`,
    tool: "artifact",
    state: {
      status: "completed",
      input: { action: "save_file", path: input.path },
      output: "Saved",
      title: `Saved Result: ${input.title}`,
      metadata: {
        savedArtifact: {
          id: input.id,
          versionID: `version_${input.id}_${version}`,
          version,
          title: input.title,
          kind: input.kind,
          path: input.path,
          mimeType: input.mimeType,
          size: 12,
          sha256: String(version).repeat(64),
        },
      },
      time: { start: version, end: version + 1 },
    },
  }
  return {
    info: {
      id: "msg_assistant",
      parentID: "msg_user",
      sessionID: "ses_replay",
      role: "assistant",
      time: { created: 1, completed: 2 },
      modelID: "test",
      providerID: "test",
      agent: "research",
      mode: "research",
      path: { cwd: "/research", root: "/research" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
    },
    parts: [part],
    turn: "msg_user",
  }
}

test("ranks every PDF above images without relying on its title or filename", () => {
  const image = frame({
    id: "image",
    title: "Cell map",
    path: "results/cell-map.png",
    kind: "figure",
    mimeType: "image/png",
  })
  const plot = frame({
    id: "plot",
    title: "Article report figure",
    path: "paper/figures/volcano.pdf",
    kind: "report",
    mimeType: "application/pdf",
  })
  const report = frame({
    id: "report",
    title: "PBMC discovery report",
    path: "paper/pbmc_discovery_report.pdf",
    kind: "report",
    mimeType: "application/pdf",
  })

  expect(artifactRank(bestArtifact([report])!)).toBe(2)
  expect(artifactRank(bestArtifact([plot])!)).toBe(2)
  expect(artifactRank(bestArtifact([image])!)).toBe(1)
  expect(bestArtifact([report, image, plot])?.id).toBe("plot")
  expect(framePdf(plot)?.id).toBe("plot")
  expect(framePdf(report)?.id).toBe("report")
})

test("uses the newest qualifying result at the same priority and respects the replay cursor", () => {
  const first = frame({
    id: "report",
    title: "研究报告",
    path: "paper/report.pdf",
    kind: "report",
    mimeType: "application/pdf",
  })
  const second = frame({
    id: "report",
    title: "研究报告",
    path: "paper/report.pdf",
    kind: "report",
    mimeType: "application/pdf",
    version: 2,
  })

  expect(bestArtifact([first, second], 1)?.version).toBe(1)
  expect(bestArtifact([first, second])?.version).toBe(2)
})

test("ignores tables, source documents, and incomplete artifact calls", () => {
  const table = frame({
    id: "table",
    title: "Cluster summary",
    path: "results/clusters.csv",
    kind: "dataset",
    mimeType: "text/csv",
  })
  const source = frame({
    id: "source",
    title: "Manuscript source",
    path: "paper/report.tex",
    kind: "report",
    mimeType: "text/x-tex",
  })
  const pending = frame({
    id: "pending",
    title: "Pending report",
    path: "paper/report.pdf",
    kind: "report",
    mimeType: "application/pdf",
  })
  pending.parts[0] = { ...pending.parts[0], state: { status: "pending", input: {} } } as ToolPart

  expect(bestArtifact([table, source, pending])).toBeUndefined()
})
