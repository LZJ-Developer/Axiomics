import { expect, test } from "bun:test"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { SessionFilesystem } from "../../src/session/filesystem"
import { ArtifactTool } from "../../src/tool/artifact"
import { executionSession, tmpdir } from "../fixture/fixture"

const context = (sessionID: string) => ({
  sessionID,
  messageID: "msg_artifact_list_copy",
  callID: "call_artifact_list_copy",
  agent: "research",
  abort: new AbortController().signal,
  messages: [],
  metadata() {},
  async ask() {},
})

test("artifact list reports saved Results and copy returns one to the workspace", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await executionSession()
      const tool = await ArtifactTool.init()
      const workspace = await SessionFilesystem.workspace(session.id)
      await Bun.write(path.join(workspace, "results", "proportions.csv"), "cell,share\nCD4 T,0.488\n")

      const saved = await tool.execute(
        { action: "save_file", path: "results/proportions.csv", summary: "主要细胞比例表" },
        context(session.id),
      )
      const id = (saved.metadata.savedArtifact as { id: string }).id

      const listed = await tool.execute({ action: "list" }, context(session.id))
      expect(listed.title).toBe("Project Results (1)")
      expect(listed.output).toContain("主要细胞比例表")
      expect(listed.output).toContain(`id=${id}`)
      expect(listed.metadata.results).toMatchObject([
        { id, title: "主要细胞比例表", kind: "dataset", version: 1 },
      ])

      const filtered = await tool.execute({ action: "list", query: "比例" }, context(session.id))
      expect(filtered.metadata.results).toHaveLength(1)
      const missing = await tool.execute({ action: "list", query: "umap" }, context(session.id))
      expect(missing.metadata.results).toEqual([])

      await Bun.write(path.join(workspace, "results", "proportions.csv"), "overwritten\n")
      const copied = await tool.execute({ action: "copy", artifact_id: id }, context(session.id))
      expect(copied.title).toBe("Copied Result: results/proportions.csv")
      expect(await Bun.file(path.join(workspace, "results", "proportions.csv")).text()).toBe(
        "cell,share\nCD4 T,0.488\n",
      )
    },
  })
})

test("artifact copy refuses a destination outside the session workspace", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await executionSession()
      const tool = await ArtifactTool.init()
      const workspace = await SessionFilesystem.workspace(session.id)
      await Bun.write(path.join(workspace, "notes.md"), "# notes\n")
      const saved = await tool.execute({ action: "save_file", path: "notes.md" }, context(session.id))
      const id = (saved.metadata.savedArtifact as { id: string }).id

      const escaped = await tool.execute({ action: "copy", artifact_id: id, path: "../escape.md" }, context(session.id))
      expect(escaped.title).toBe("Invalid destination")
      expect(await Bun.file(path.join(path.dirname(workspace), "escape.md")).exists()).toBe(false)
    },
  })
})

test("artifact copy reports an unknown Result instead of writing", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await executionSession()
      const tool = await ArtifactTool.init()
      const workspace = await SessionFilesystem.workspace(session.id)
      const missing = await tool.execute({ action: "copy", artifact_id: "art_missing" }, context(session.id))
      expect(missing.title).toBe("Result not found")
      expect(await Bun.file(path.join(workspace, "results")).exists()).toBe(false)
    },
  })
})
