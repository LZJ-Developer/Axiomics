import { describe, expect, test } from "bun:test"

const root = new URL("../", import.meta.url).pathname
const files = await Array.fromAsync(new Bun.Glob("**/*.{css,ts,tsx}").scan({ cwd: root }))
const source = async (path: string) => {
  const text = await Bun.file(new URL(path, new URL("../", import.meta.url))).text()
  // Font-face descriptors describe bundled files, not interface hierarchy.
  return text.replace(/@font-face\s*\{[^}]*\}/gs, "")
}

describe("workspace typography drift", () => {
  test("uses semantic weight tokens instead of page-specific numerals", async () => {
    for (const path of files) {
      if (path.includes(".test.")) continue
      const text = await source(path)

      expect(text.match(/(?<!-)font-weight:\s*(?:[1-9]\d{2}|bold|normal)\b/g), path).toBeNull()
      expect(text.match(/["']font-weight["']:\s*(?:[1-9]\d{2}|["'][1-9]\d{2}["'])/g), path).toBeNull()
    }
  })

  test("does not force ordinary interface copy into a different case", async () => {
    for (const path of files) {
      if (path.includes(".test.")) continue
      const text = await source(path)

      expect(text.match(/text-transform:\s*(?:uppercase|lowercase|capitalize)\b/g), path).toBeNull()
      expect(text.match(/["']text-transform["']:\s*["'](?:uppercase|lowercase|capitalize)["']/g), path).toBeNull()
      expect(text.match(/\b(?:uppercase|lowercase|capitalize)\b(?=[^"'\n]*["'])/g), path).toBeNull()
    }
  })

  test("keeps readable sizes on the role ramp instead of fractional one-offs", async () => {
    for (const path of files) {
      if (path.includes(".test.")) continue
      const text = await source(path)
      // Sub-8px values are drawing, not type: artifact thumbnails render text at
      // 3.6px/8px as texture. Everything a reader actually reads uses the ramp.
      const fractional = [...text.matchAll(/font-size:\s*(\d+\.\d+)px/g)]
        .map((match) => Number(match[1]))
        .filter((size) => size >= 8)
      const inline = [...text.matchAll(/["']font-size["']:\s*["'](\d+\.\d+)px["']/g)]
        .map((match) => Number(match[1]))
        .filter((size) => size >= 8)

      expect(fractional, path).toEqual([])
      expect(inline, path).toEqual([])
    }
  })
})
