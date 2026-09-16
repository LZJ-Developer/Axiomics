import { expect, test } from "bun:test"
import type { AssistantMessage, Part, TextPart } from "@axiomics/sdk/v2/client"
import { finalResponse } from "./session-turn-response"

const text = (id: string, value: string, input: Partial<TextPart> = {}): TextPart => ({
  id,
  messageID: "msg_test",
  sessionID: "ses_test",
  type: "text",
  text: value,
  ...input,
})

const assistant = (finish?: string): AssistantMessage => ({
  id: "msg_test",
  parentID: "msg_user",
  sessionID: "ses_test",
  role: "assistant",
  time: { created: 1, completed: 2 },
  modelID: "test",
  providerID: "test",
  agent: "research",
  mode: "research",
  path: { cwd: "/research", root: "/research" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  finish,
})

test("synthetic, ignored, and blank prose never replace the assistant's final response", () => {
  const response = text("prt_response", "Verified outcome")
  const notice = text("prt_notice", "Incomplete research contract", { synthetic: true })
  const ignored = text("prt_ignored", "Discarded retry", { ignored: true })
  const values = [response, notice, ignored, text("prt_blank", " ")]

  expect(finalResponse([assistant("stop")], () => values)?.part).toEqual(response)
  expect(finalResponse([assistant("stop")], () => [notice, ignored])).toBeUndefined()
})

test("only the terminal provider step contributes a final response", () => {
  const progress = text("prt_progress", "Loading the matrix")
  const answer = text("prt_answer", "# Finding\n\nThe treated cells separate clearly.")
  const parts = new Map<string, Part[]>([["msg_test", [progress, answer]]])
  const final = finalResponse([assistant("stop")], (id) => parts.get(id) ?? [])

  expect(final?.part).toEqual(answer)
  expect(final?.part.text).toBe(answer.text)
})

test("an unfinished, compacting, or tool-continuing step stays in the execution trace", () => {
  const prose = text("prt_progress", "I will inspect the markers next.")
  const tool: Part = {
    id: "prt_tool",
    messageID: "msg_test",
    sessionID: "ses_test",
    type: "tool",
    callID: "call_test",
    tool: "bash",
    state: { status: "pending", input: {}, raw: "" },
  }
  const values = [prose, tool]
  const streaming = { ...assistant("stop"), time: { created: 1 } }

  expect(finalResponse([assistant()], () => values)).toBeUndefined()
  expect(finalResponse([streaming], () => values)).toBeUndefined()
  expect(finalResponse([assistant("tool-calls")], () => values)).toBeUndefined()
  expect(finalResponse([assistant("unknown")], () => values)).toBeUndefined()
  expect(finalResponse([assistant("compact")], () => values)).toBeUndefined()
})

test("unknown without a tool is terminal for providers that omit a precise finish reason", () => {
  const prose = text("prt_answer", "Analysis complete")
  const final = finalResponse([assistant("unknown")], () => [prose])
  expect(final?.part.text).toBe("Analysis complete")
})

test("the last provider message owns the answer and source Markdown remains intact", () => {
  const source = "    indented_code()\n\n[Plan](/research/project/PLAN.md)\n\n```text\n  evidence\n```\n"
  const earlier = { ...assistant("tool-calls"), id: "msg_earlier" }
  const current = assistant("stop")
  const final = finalResponse([earlier, current], (id) =>
    id === current.id ? [text("prt_answer", source)] : [text("prt_progress", "Do not copy this progress")],
  )

  expect(final?.part.text).toBe(source)
})
