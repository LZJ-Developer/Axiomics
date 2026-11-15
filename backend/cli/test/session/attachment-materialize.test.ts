import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionFilesystem } from "../../src/session/filesystem"
import type { MessageV2 } from "../../src/session/message-v2"
import { Token } from "../../src/util/token"
import { tmpdir } from "../fixture/fixture"

const model = { providerID: "deepseek", modelID: "deepseek-flash" }
const csv = "gene,log2fc,padj\nEGFR,2.1,0.001\nMYC,-1.4,0.02\nTP53,0.9,0.4\n"

/** A chat attachment is not only seen by the model inline: the server writes it
 * into the session workspace and hands the model a path. That is what makes an
 * uploaded CSV/PDF readable by tools (and what a regression would silently
 * break, leaving the model with a truncated 64k-char inline copy). */
test("materializes a chat attachment into the session workspace", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const message = await SessionPrompt.prompt({
        sessionID: session.id,
        model,
        agent: "research",
        noReply: true,
        parts: [
          {
            type: "file",
            url: `data:text/csv;base64,${Buffer.from(csv).toString("base64")}`,
            filename: "deg.csv",
            mime: "text/csv",
          },
        ],
      })

      const workspace = await SessionFilesystem.workspace(session.id)
      const files = await fs.readdir(workspace)
      const saved = files.find((name) => name.startsWith("attachment-0-") && name.endsWith("-deg.csv"))
      expect(saved).toBeDefined()
      expect(await fs.readFile(`${workspace}/${saved}`, "utf8")).toBe(csv)

      const hint = message.parts.find((part) => part.type === "text" && part.text.includes(" is saved at "))
      expect(hint?.type).toBe("text")
      const text = hint?.type === "text" ? hint.text : ""
      expect(text).toContain(`${workspace}/${saved}`)
      expect(text).toContain("Read it with the read tool")
      await Session.remove(session.id)
    },
  })
}, 30_000)

/** A binary handoff takes the same materialise path, but the hint must not tell
 * the model to read it as text — a .npz is a zip of arrays, and the read tool
 * would hand back mojibake. The composer maps .npz/.npy to octet-stream because
 * browsers report no MIME for them (prompt-attachment.ts). */
test("materialises a binary attachment and points the model at python", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10, 0x00, 0x80, 0x7f])
      const message = await SessionPrompt.prompt({
        sessionID: session.id,
        model,
        agent: "research",
        noReply: true,
        parts: [
          {
            type: "file",
            url: `data:application/octet-stream;base64,${bytes.toString("base64")}`,
            filename: "counts.npz",
            mime: "application/octet-stream",
          },
        ],
      })

      const workspace = await SessionFilesystem.workspace(session.id)
      const saved = (await fs.readdir(workspace)).find((name) => name.endsWith("-counts.npz"))
      expect(saved).toBeDefined()
      expect(await fs.readFile(`${workspace}/${saved}`)).toEqual(bytes)

      const hint = message.parts.find((part) => part.type === "text" && part.text.includes(" is saved at "))
      const text = hint?.type === "text" ? hint.text : ""
      expect(text).toContain("It is binary")
      expect(text).toContain("python tool")
      expect(text).not.toContain("Read it with the read tool")
      await Session.remove(session.id)
    },
  })
}, 30_000)

/** The context budget must not charge bytes the provider never receives. A
 * materialised attachment reaches the model as a path (message-v2 skips its
 * data URL), yet the budget used to estimate the full base64: a 3 MB CSV read
 * as ~1M tokens and failed the turn with "remove large attachments" before any
 * provider request. The budget and the wire now share one predicate. */
test("does not charge a materialised attachment against the context budget", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const big = csv.repeat(Math.ceil((300 * 1024) / csv.length)).slice(0, 300 * 1024)
      await SessionPrompt.prompt({
        sessionID: session.id,
        model,
        agent: "research",
        noReply: true,
        parts: [
          {
            type: "file",
            url: `data:text/csv;base64,${Buffer.from(big).toString("base64")}`,
            filename: "counts.csv",
            mime: "text/csv",
          },
        ],
      })

      const messages = await Session.messages({ sessionID: session.id })
      const user = messages.filter((message) => message.info.role === "user")
      const newest = user.at(-1)!
      const preflight = await SessionPrompt.contextPreflight({
        messages: user,
        current: newest.info as MessageV2.User,
        system: [],
        tools: {},
        model: { limit: { context: 8_000, output: 1_000 } } as never,
      })

      const part = user.at(-1)!.parts.find((item) => item.type === "file")
      const raw = part?.type === "file" ? Token.estimate(part.url) : 0
      // The attachment alone would blow this small window; the path hint does not.
      expect(raw).toBeGreaterThan(preflight.hard)
      expect(preflight.newest).toBeLessThanOrEqual(preflight.hard)
      expect(preflight.newest).toBeLessThan(500)
      await Session.remove(session.id)
    },
  })
}, 30_000)
