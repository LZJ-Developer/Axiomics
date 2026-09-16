import type { AssistantMessage, Part, TextPart } from "@axiomics/sdk/v2/client"

export type FinalResponse = {
  message: AssistantMessage
  part: TextPart
}

/** A turn's final answer belongs to its terminal provider step. Earlier prose is
 * progress in the execution trace, even when it is the newest visible text. */
export function finalResponse(messages: readonly AssistantMessage[], parts: (messageID: string) => readonly Part[]) {
  const message = messages.at(-1)
  if (!message?.time.completed || !message.finish || message.summary || message.finish === "compact") return

  const values = parts(message.id)
  if (message.finish === "tool-calls") return
  if (message.finish === "unknown" && values.some((part) => part.type === "tool")) return

  const part = values.findLast(
    (part): part is TextPart => part.type === "text" && !part.synthetic && !part.ignored && !!part.text.trim(),
  )
  if (!part) return
  return { message, part } satisfies FinalResponse
}
