import { describe, expect, test } from "bun:test"
import { isCrossOrigin, isTopLevelNavigation } from "./host-guard"

const HOSTED = "https://axiomics.example.cn:8444"

describe("isTopLevelNavigation", () => {
  test("only a navigate-mode GET or HEAD counts", () => {
    expect(isTopLevelNavigation("navigate", "GET")).toBe(true)
    expect(isTopLevelNavigation("navigate", "HEAD")).toBe(true)
    expect(isTopLevelNavigation("navigate", "POST")).toBe(false)
    expect(isTopLevelNavigation("cors", "GET")).toBe(false)
    expect(isTopLevelNavigation(undefined, "GET")).toBe(false)
  })
})

describe("isCrossOrigin", () => {
  test("a foreign Origin is rejected whatever the request shape", () => {
    expect(isCrossOrigin("https://evil.example", "same-origin")).toBe(true)
    expect(isCrossOrigin("https://evil.example", "cross-site", [], true)).toBe(true)
  })

  test("the configured hosted origin is accepted", () => {
    expect(isCrossOrigin(HOSTED, "same-origin", [HOSTED])).toBe(false)
  })

  test("the hosted origin is not accepted unless it was configured", () => {
    expect(isCrossOrigin(HOSTED, "same-origin")).toBe(true)
  })

  test("cross-site fetch without Origin is still rejected", () => {
    expect(isCrossOrigin(undefined, "cross-site")).toBe(true)
    expect(isCrossOrigin(undefined, "cross-site", [], false)).toBe(true)
  })

  test("a cross-site GET navigation is allowed to land", () => {
    expect(isCrossOrigin(undefined, "cross-site", [], true)).toBe(false)
  })

  test("same-origin and header-less clients pass", () => {
    expect(isCrossOrigin(undefined, "same-origin")).toBe(false)
    expect(isCrossOrigin(undefined, "none")).toBe(false)
    expect(isCrossOrigin(undefined, undefined)).toBe(false)
  })
})
