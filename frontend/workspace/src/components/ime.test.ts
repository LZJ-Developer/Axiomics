import { describe, expect, test } from "bun:test"
import { imeOwnsKey, staleComposition } from "./ime"

function key(init: { isComposing?: boolean; keyCode?: number } = {}) {
  const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: init.isComposing ?? false })
  if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", { get: () => init.keyCode })
  return event
}

describe("input method ownership", () => {
  test("a composing keydown belongs to the IME", () => {
    expect(imeOwnsKey(key({ isComposing: true }), false)).toBe(true)
  })

  test("a live composition flag belongs to the IME even if the event lags", () => {
    expect(imeOwnsKey(key(), true)).toBe(true)
  })

  // Measured in the running product: an Enter with `keyCode 229`, `isComposing`
  // false and no local composition sent nothing — no request, no toast, text
  // left in the composer. 229 also shows up on ordinary keys once an IME is
  // active, so it cannot stand in for "a composition is live".
  test("keyCode 229 alone does not mean the IME owns the key", () => {
    expect(imeOwnsKey(key({ keyCode: 229 }), false)).toBe(false)
  })

  test("a plain Enter is ours", () => {
    expect(imeOwnsKey(key({ keyCode: 13 }), false)).toBe(false)
  })
})

describe("stale composition", () => {
  // Measured: with `compositionend` missed, Enter kept sending nothing until the
  // composer was blurred and refocused; the same Enter then sent.
  test("a flag that outlives its composition is stale", () => {
    expect(staleComposition(key(), true)).toBe(true)
  })

  test("a composition that is still running is not stale", () => {
    expect(staleComposition(key({ isComposing: true }), true)).toBe(false)
  })

  test("no flag, nothing to clear", () => {
    expect(staleComposition(key(), false)).toBe(false)
  })
})
