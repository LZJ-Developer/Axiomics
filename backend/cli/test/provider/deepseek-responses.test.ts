import { describe, expect, test } from "bun:test"
import { convertToOpenAIResponsesInput } from "../../src/provider/sdk/openai-compatible/src/responses/convert-to-openai-responses-input"
import { createOpenaiCompatible } from "../../src/provider/sdk/openai-compatible/src"
import { generateText, tool } from "ai"
import z from "zod"

describe("DeepSeek Responses input", () => {
  test("uses the Responses endpoint with stateless reasoning and tools", async () => {
    const requests: Request[] = []
    const sdk = createOpenaiCompatible({
      apiKey: "test",
      baseURL: "https://deepseek.test",
      responses: {
        defaultStore: false,
        systemMessageMode: "system",
        reasoningModel: true,
        toolOutputMedia: true,
        fileIdPrefixes: ["file-api-"],
        supportedUrls: {
          "image/*": [/^https?:\/\/.*$/, /^axiomics-media:\/\/med_[0-9a-f]{32}$/],
        },
      },
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init))
        return Response.json({ error: { message: "captured" } }, { status: 400 })
      }) as typeof globalThis.fetch,
    })
    await generateText({
      model: sdk.responses("deepseek-v4-flash-vision-exp"),
      system: "Work as a research agent.",
      prompt: "Inspect this experiment.",
      providerOptions: { openai: { reasoningEffort: "max" } },
      tools: { inspect: tool({ description: "Inspect", inputSchema: z.object({ path: z.string() }) }) },
    }).catch(() => undefined)

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe("https://deepseek.test/responses")
    const body = (await requests[0].json()) as Record<string, unknown>
    expect(body).toMatchObject({
      model: "deepseek-v4-flash-vision-exp",
      store: false,
      reasoning: { effort: "max" },
    })
    expect(body.tools).toBeArray()
  })

  test("passes local media references to the request adapter without downloading them", async () => {
    const requests: Request[] = []
    const sdk = createOpenaiCompatible({
      apiKey: "test",
      baseURL: "https://deepseek.test",
      responses: {
        defaultStore: false,
        systemMessageMode: "system",
        reasoningModel: true,
        fileIdPrefixes: ["file-api-"],
        supportedUrls: {
          "image/*": [/^axiomics-media:\/\/med_[0-9a-f]{32}$/],
        },
      },
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(new Request(input, init))
        return Response.json({ error: { message: "captured" } }, { status: 400 })
      }) as typeof globalThis.fetch,
    })
    const reference = "axiomics-media://med_0123456789abcdef0123456789abcdef"
    await generateText({
      model: sdk.responses("deepseek-v4-flash-vision-exp"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What color is this image?" },
            { type: "image", image: new URL(reference), mediaType: "image/png" },
          ],
        },
      ],
    }).catch(() => undefined)

    expect(requests).toHaveLength(1)
    expect(JSON.stringify(await requests[0].json())).toContain(reference)
  })

  test("keeps tool-produced images as function output content", async () => {
    const result = await convertToOpenAIResponsesInput({
      prompt: [
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call_1", toolName: "notebook", input: {} }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "notebook",
              output: {
                type: "content",
                value: [
                  { type: "text", text: "Rendered a UMAP" },
                  {
                    type: "media",
                    mediaType: "image/png",
                    data: "axiomics-media://med_0123456789abcdef0123456789abcdef",
                  },
                ],
              },
            },
          ],
        },
      ],
      systemMessageMode: "system",
      fileIdPrefixes: ["file-api-"],
      store: false,
      toolOutputMedia: true,
    })
    expect(result.input.at(-1)).toEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: [
        { type: "input_text", text: "Rendered a UMAP" },
        { type: "input_image", image_url: "axiomics-media://med_0123456789abcdef0123456789abcdef" },
      ],
    })
    expect(JSON.stringify(result.input)).not.toContain("base64")
  })
})
