import { describe, expect, test } from "bun:test"
import { cases } from "./cases/catalog"
import { STARTER_CASE_IDS, starterCases } from "./session-empty-cases"

describe("session empty starters", () => {
  test("every pinned id exists in the catalog", () => {
    const ids = new Set(cases.map((item) => item.id))
    for (const id of STARTER_CASE_IDS) expect(ids.has(id)).toBe(true)
  })

  test("starters do not repeat the gallery's first row", () => {
    const firstRow = cases.slice(0, STARTER_CASE_IDS.length).map((item) => item.id)
    for (const id of STARTER_CASE_IDS) expect(firstRow).not.toContain(id)
  })

  test("starters cover three different omics", () => {
    const omics = new Set(starterCases().map((item) => item.omics))
    expect(omics.size).toBe(STARTER_CASE_IDS.length)
  })
})
