import { describe, expect, test } from "bun:test"
import { runMessage } from "../../src/cli/cmd/run"

describe("axiomics run message assembly", () => {
  test("joins parsed positional arguments without reintroducing shell quotes", () => {
    expect(runMessage(["Explain this concept clearly."])).toBe("Explain this concept clearly.")
    expect(runMessage(["Explain this", "concept clearly."])).toBe("Explain this concept clearly.")
  })

  test("preserves quote and shell-like characters as user text", () => {
    expect(runMessage(['Explain "selection bias"', "$HOME", "`literal`"])).toBe(
      'Explain "selection bias" $HOME `literal`',
    )
  })

  test("joins piped input without storing terminal line padding", () => {
    expect(runMessage([], "研究这批细胞。\n")).toBe("研究这批细胞。")
    expect(runMessage(["补充要求："], "\n  保留正文首行缩进\n\n第二段\n")).toBe(
      "补充要求：\n  保留正文首行缩进\n\n第二段",
    )
    expect(runMessage(["只用位置参数"], "")).toBe("只用位置参数")
  })
})
