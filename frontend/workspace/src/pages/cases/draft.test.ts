import { describe, expect, test } from "bun:test"
import { saveDraft, takeDraft } from "./draft"

function memory(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

describe("anonymous hand-off draft", () => {
  test("a typed question survives to the workspace exactly once", () => {
    const storage = memory()
    saveDraft("  比较两种注释方法  ", storage)
    expect(takeDraft(storage)).toBe("比较两种注释方法")
    // Consumed: a later workspace load must not refill the composer.
    expect(takeDraft(storage)).toBeUndefined()
  })

  test("blank input is not a draft", () => {
    const storage = memory()
    saveDraft("   \n  ", storage)
    expect(takeDraft(storage)).toBeUndefined()
  })

  test("storage that refuses writes does not throw into the submit path", () => {
    const storage = memory()
    storage.setItem = () => {
      throw new Error("quota")
    }
    expect(() => saveDraft("question", storage)).not.toThrow()
  })
})
