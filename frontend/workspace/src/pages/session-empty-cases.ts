import { cases, type ShowcaseCase } from "./cases/catalog"

/**
 * Starter cases for the empty conversation screen.
 *
 * Pinned by id on purpose. Taking the catalog's first three would repeat the
 * gallery's first row on the landing screen, and deriving the set from catalog
 * order would let a reorder silently change what a new user sees first.
 *
 * The three cover 三维基因组 / 空间蛋白组 / 空间多组学 — modalities the gallery's
 * opening row (all transcriptomics) does not already show.
 */
export const STARTER_CASE_IDS = ["open2c-hesc-hff", "mcmicro-luad", "stamo-p22"] as const

export function starterCases(): ShowcaseCase[] {
  const byId = new Map(cases.map((item) => [item.id, item]))
  const missing = STARTER_CASE_IDS.filter((id) => !byId.has(id))
  if (missing.length > 0) throw new Error(`starter cases missing from catalog: ${missing.join(", ")}`)
  return STARTER_CASE_IDS.map((id) => byId.get(id)!)
}
