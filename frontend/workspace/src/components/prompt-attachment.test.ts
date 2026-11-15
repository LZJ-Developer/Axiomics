import { describe, expect, test } from "bun:test"
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  attachmentFormat,
  attachmentMime,
  attachmentSize,
} from "./prompt-attachment"

describe("prompt attachments", () => {
  test("accepts scientific text and data files even when the browser omits MIME", () => {
    expect(attachmentMime({ name: "growth.csv", type: "" })).toBe("text/csv")
    expect(attachmentMime({ name: "variants.vcf", type: "" })).toBe("text/x-vcf")
    expect(attachmentMime({ name: "analysis.ipynb", type: "application/octet-stream" })).toBe(
      "application/x-ipynb+json",
    )
    expect(attachmentMime({ name: "weights.bin", type: "application/octet-stream" })).toBeUndefined()
    // An expert's array handoff has no browser MIME at all; the extension decides.
    expect(attachmentMime({ name: "counts.npz", type: "" })).toBe("application/octet-stream")
    expect(attachmentMime({ name: "embedding.npy", type: "" })).toBe("application/octet-stream")
    expect(ATTACHMENT_ACCEPT).toContain(".csv")
    expect(ATTACHMENT_ACCEPT).toContain(".npz")
    expect(MAX_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024)
  })

  test("formats visible attachment sizes", () => {
    expect(attachmentSize(812)).toBe("812 B")
    expect(attachmentSize(12_288)).toBe("12 KB")
    expect(attachmentSize(2_621_440)).toBe("2.5 MB")
  })

  test("keeps the real file extension visible", () => {
    expect(attachmentFormat({ name: "methods.pdf", type: "application/pdf" })).toBe("PDF")
    expect(attachmentFormat({ name: "counts.tsv", type: "text/tab-separated-values" })).toBe("TSV")
    expect(attachmentFormat({ name: "clipboard", type: "image/png" })).toBe("PNG")
  })
})
