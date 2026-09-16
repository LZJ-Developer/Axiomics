import { expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { MediaStore } from "../../src/media/store"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { tmpdir } from "../fixture/fixture"

test("stores scientific figures by reference before persisting the tool result", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const updates: MessageV2.ToolPart[] = []
      const coordinator = SessionProcessor.createToolOutcomeCoordinator({
        abort: new AbortController().signal,
        async updatePart(part) {
          updates.push(part)
        },
      })
      const part: MessageV2.ToolPart & { state: MessageV2.ToolStateRunning } = {
        id: Identifier.ascending("part"),
        sessionID: "ses_media_processor",
        messageID: "msg_media_processor",
        type: "tool",
        tool: "notebook",
        callID: "call_figure",
        state: { status: "running", input: {}, time: { start: Date.now() } },
      }
      await coordinator.running(part)
      await coordinator.execute(part.callID, {}, async () => ({
        title: "Render UMAP",
        output: "[figure] captured 1 inline image(s)",
        metadata: { artifact: { kind: "image" } },
        attachments: [
          {
            id: Identifier.ascending("part"),
            sessionID: part.sessionID,
            messageID: part.messageID,
            type: "file" as const,
            mime: "image/png",
            filename: "umap.png",
            url: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`,
          },
        ],
      }))
      const state = updates.at(-1)?.state
      if (state?.status !== "completed") throw new Error("figure tool did not complete")
      const url = state.attachments?.[0]?.url ?? ""
      const mediaID = MediaStore.parse(url)
      expect(mediaID).toMatch(/^med_[0-9a-f]{32}$/)
      expect(JSON.stringify(state)).not.toContain("base64")
      expect(state.metadata.artifact).toEqual({ kind: "image", data: { images: [url] } })
      if (!mediaID) throw new Error("figure was not stored as media")
      expect((await MediaStore.read(mediaID)).bytes).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))
      await MediaStore.removeSession(Instance.project.id, part.sessionID)
    },
  })
})
