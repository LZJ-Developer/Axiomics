import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { cases, cover } from "./catalog"

const PUBLIC = fileURLToPath(new URL("../../../public", import.meta.url))

describe("case cover thumbnails", () => {
  test("maps a case image to its thumbnail path", () => {
    expect(cover("/cases/pbmc-umap.png")).toBe("/cases/thumbs/pbmc-umap.webp")
    expect(cover("/cases/spatial-proteomics-overlay.jpg")).toBe("/cases/thumbs/spatial-proteomics-overlay.webp")
    // Anything not served from /cases/ is left alone.
    expect(cover("https://example.test/fig.png")).toBe("https://example.test/fig.png")
  })

  // The gallery requests the thumbnail directly, with no runtime fallback, so a
  // new or renamed figure must not ship without one. Regenerate with
  //   python3 script/case-thumbs.py
  test("every gallery cover has a generated thumbnail on disk", () => {
    const missing = cases.flatMap((item) =>
      item.images
        .map((src) => cover(src))
        .filter((src) => !existsSync(`${PUBLIC}${src}`))
        .map((src) => `${item.id}: ${src}`),
    )

    expect(missing).toEqual([])
  })
})
