import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dict } from "../i18n/en"

const source = readFileSync(fileURLToPath(new URL("./cases-gallery.tsx", import.meta.url)), "utf8")

describe("gallery result count", () => {
  test("has a singular string, not just a plural one", () => {
    expect(dict["cases.showing"]).toBe("Showing {{count}} curated cases")
    expect(dict["cases.showingOne"]).toBe("Showing {{count}} curated case")
  })

  // The gallery picked the plural string unconditionally and rendered
  // "Showing 1 curated cases" when a filter narrowed the result to one.
  test("picks the singular string when exactly one case matches", () => {
    expect(source).toContain('shown().length === 1 ? "cases.showingOne" : "cases.showing"')
  })
})
