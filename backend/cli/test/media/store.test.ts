import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { MediaStore } from "../../src/media/store"
import { tmpdir } from "../fixture/fixture"
import { FileRoutes } from "../../src/server/routes/file"

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x00, 0x00, 0x03,
])

describe("media store", () => {
  test("persists image bytes behind a compact message reference", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const record = await MediaStore.capture({
          bytes: png,
          mime: "text/plain",
          origin: "upload",
          sessionID: "ses_media_test",
          messageID: "msg_media_test",
          filename: "plot.png",
        })
        const url = MediaStore.uri(record.id)
        expect(url).toMatch(/^axiomics-media:\/\/med_[0-9a-f]{32}$/)
        expect(JSON.stringify(record)).not.toContain("base64")
        expect(record).toMatchObject({ mime: "image/png", size: png.byteLength, width: 2, height: 3 })
        expect(MediaStore.dataUrlSync(url)).toBe(`data:image/png;base64,${Buffer.from(png).toString("base64")}`)
        expect((await MediaStore.read(record.id)).bytes).toEqual(png)
        const response = await FileRoutes().request(`/media/${record.id}`)
        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toBe("image/png")
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(png)
        await MediaStore.removeSession(Instance.project.id, "ses_media_test")
        await expect(MediaStore.get(record.id)).rejects.toThrow()
        expect((await FileRoutes().request(`/media/${record.id}`)).status).toBe(404)
      },
    })
  })
})
