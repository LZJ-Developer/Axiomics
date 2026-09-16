import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { DeepSeekMedia } from "../../src/media/deepseek"
import { MediaStore } from "../../src/media/store"
import { tmpdir } from "../fixture/fixture"

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01,
])

describe("DeepSeek media files", () => {
  test("uploads once, reuses the file id, and refreshes an invalid binding", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const media = await MediaStore.capture({
          bytes: png,
          mime: "image/png",
          origin: "python",
          sessionID: "ses_deepseek_media",
          messageID: "msg_deepseek_media",
          filename: "umap.png",
        })
        const requests: Request[] = []
        const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
          requests.push(new Request(input, init))
          const serial = requests.length
          return Response.json({
            id: `file-api-${serial}`,
            expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          })
        }) as typeof fetch
        const body = {
          input: [
            {
              type: "function_call_output",
              call_id: "call_1",
              output: [{ type: "input_image", image_url: MediaStore.uri(media.id) }],
            },
          ],
        }
        const first = await DeepSeekMedia.prepare({
          body,
          baseURL: "https://deepseek.test",
          apiKey: "key",
          fetch: fetcher,
        })
        const second = await DeepSeekMedia.prepare({
          body,
          baseURL: "https://deepseek.test",
          apiKey: "key",
          fetch: fetcher,
        })
        expect(requests).toHaveLength(1)
        expect(first.body).toEqual(second.body)
        expect(JSON.stringify(first.body)).toContain('"file_id":"file-api-1"')
        expect(requests[0].url).toBe("https://deepseek.test/files")
        expect((await requests[0].formData()).get("purpose")).toBe("user_data")

        const refreshed = await DeepSeekMedia.prepare({
          body,
          baseURL: "https://deepseek.test",
          apiKey: "key",
          fetch: fetcher,
          refresh: true,
        })
        expect(requests).toHaveLength(2)
        expect(JSON.stringify(refreshed.body)).toContain('"file_id":"file-api-2"')
        expect(await DeepSeekMedia.isMissing(Response.json({ error: "file_id not found" }, { status: 400 }))).toBe(true)
        await MediaStore.removeSession(Instance.project.id, "ses_deepseek_media")
      },
    })
  })
})
