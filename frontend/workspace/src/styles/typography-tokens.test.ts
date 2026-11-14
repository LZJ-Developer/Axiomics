import { describe, expect, test } from "bun:test"
import { FONT_WEIGHT, sectionTitle } from "./tokens"

describe("workspace typography tokens", () => {
  test("mirrors the shared quiet weight scale", async () => {
    const css = await Bun.file(new URL("../../../ui/src/styles/theme.css", import.meta.url)).text()

    expect(FONT_WEIGHT).toEqual({ regular: 380, medium: 480, emphasis: 500 })
    expect(sectionTitle["font-weight"]).toBe(FONT_WEIGHT.medium)
    expect(css).toContain(`--font-weight-regular: ${FONT_WEIGHT.regular}`)
    expect(css).toContain(`--font-weight-medium: ${FONT_WEIGHT.medium}`)
    expect(css).toContain(`--font-weight-emphasis: ${FONT_WEIGHT.emphasis}`)
  })

  test("publishes one role ramp for product typography", async () => {
    const css = await Bun.file(new URL("../../../ui/src/styles/theme.css", import.meta.url)).text()

    expect(css).toContain("--type-label: var(--font-size-x-small)")
    expect(css).toContain("--type-meta: var(--font-size-small)")
    expect(css).toContain("--type-ui: 13px")
    expect(css).toContain("--type-body: var(--font-size-base)")
    expect(css).toContain("--type-title: var(--font-size-large)")
    expect(css).toContain("--type-display: 18px")
  })
})
