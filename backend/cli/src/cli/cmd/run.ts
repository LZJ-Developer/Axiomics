import type { Argv } from "yargs"
import type z from "zod"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Command } from "../../command"
import { EOL } from "os"
import { select } from "@clack/prompts"
import { createAxiomicsClient, type AxiomicsClient, type PermissionRequest } from "@axiomics/sdk/v2"
import { NamedError } from "@axiomics/util/error"
import { Server } from "../../server/server"
import { Provider } from "../../provider/provider"
import { Agent } from "../../agent/agent"
import { RunEvents } from "../run-events"
import { FormatUnknownError } from "../error"

const TOOL: Record<string, [string, string]> = {
  todowrite: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  todoread: ["Todo", UI.Style.TEXT_WARNING_BOLD],
  bash: ["Bash", UI.Style.TEXT_DANGER_BOLD],
  edit: ["Edit", UI.Style.TEXT_SUCCESS_BOLD],
  glob: ["Glob", UI.Style.TEXT_INFO_BOLD],
  grep: ["Grep", UI.Style.TEXT_INFO_BOLD],
  list: ["List", UI.Style.TEXT_INFO_BOLD],
  read: ["Read", UI.Style.TEXT_HIGHLIGHT_BOLD],
  write: ["Write", UI.Style.TEXT_SUCCESS_BOLD],
  websearch: ["Search", UI.Style.TEXT_DIM_BOLD],
  research_search: ["Search", UI.Style.TEXT_DIM_BOLD],
}

/** `run` has no question UI, so every session it creates denies the question tool. */
const QUESTION_DENY = [{ permission: "question", pattern: "*", action: "deny" as const }]

// After prompt submission, allow the event stream this long to observe either
// activity or completion. Once activity appears, the run has no time limit.
const IDLE_GRACE_MS = { settled: 10_000, failed: 2_000 }

export function runMessage(parts: string[], stdin = "") {
  const clean = (value: string) =>
    value.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "")
  return [parts.join(" "), stdin]
    .map(clean)
    .filter((part) => part.length > 0)
    .join("\n")
}

/** How `run` answers permission and question requests during the turn. */
export type RunPolicy = "allow" | "project" | "deny" | "interactive"

export type RunFile = Extract<z.infer<typeof RunEvents.UserPart>, { type: "file" }>

export type RunInput = {
  sdk: AxiomicsClient
  sessionID: string
  message: string
  files: RunFile[]
  command?: string
  model?: string
  agent?: string
  variant?: string
  effort: "normal" | "ultra"
  bare: boolean
  format: "default" | "json"
  policy: RunPolicy
  /** Observe an already-running turn without adding another user message. */
  reattach?: boolean
  /** Sink for JSON events; defaults to the process stdout. */
  stdout?: { write(text: string): unknown }
}

type Payload<T> = T extends unknown ? Omit<T, "timestamp" | "sessionID"> : never

/** Find or create the session `run` drives; both the local and `--attach` paths share it. */
export async function session(
  sdk: AxiomicsClient,
  input: { continue?: boolean; session?: string; title?: string; message: string },
) {
  if (input.continue) {
    const result = await sdk.session.list()
    return result.data?.find((s) => !s.parentID)?.id
  }
  if (input.session) return input.session
  const title =
    input.title === undefined
      ? undefined
      : input.title === ""
        ? input.message.slice(0, 50) + (input.message.length > 50 ? "..." : "")
        : input.title
  const result = await sdk.session.create({ ...(title ? { title } : {}), permission: QUESTION_DENY })
  return result.data?.id
}

async function settle(promise: Promise<unknown>, ms: number) {
  const timeout = Promise.withResolvers<false>()
  const timer = setTimeout(() => timeout.resolve(false), ms)
  return Promise.race([promise.then(() => true), timeout.promise]).finally(() => clearTimeout(timer))
}

export function describe(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (!error || typeof error !== "object") return String(error)

  const seen = new Set<object>()
  const find = (value: unknown): string | undefined => {
    if (value instanceof Error) return value.message
    if (typeof value === "string" && value.trim()) return value
    if (!value || typeof value !== "object" || seen.has(value)) return
    seen.add(value)
    const record = value as Record<string, unknown>
    for (const key of ["message", "detail", "reason"]) {
      const found = find(record[key])
      if (found) return found
    }
    for (const key of ["error", "data", "body", "cause"]) {
      const found = find(record[key])
      if (found) return found
    }
  }
  return find(error) ?? FormatUnknownError(error)
}

/** Run one prompt (or command) to completion and return the process exit code. */
export async function execute(input: RunInput): Promise<number> {
  const sdk = input.sdk
  const sessionID = input.sessionID
  const out = input.stdout ?? process.stdout
  const json = input.format === "json"

  const printEvent = (color: string, type: string, title: string) => {
    UI.println(
      color + `|`,
      UI.Style.TEXT_NORMAL + UI.Style.TEXT_DIM + ` ${type.padEnd(7, " ")}`,
      "",
      UI.Style.TEXT_NORMAL + title,
    )
  }

  const emit = (event: Payload<RunEvents.Event>) => {
    if (!json) return false
    const { type, ...data } = event
    out.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
    return true
  }

  const usage = (message: string) => {
    if (!emit({ type: "error", error: new NamedError.Unknown({ message }).toObject() })) UI.error(message)
    emit({
      type: "done",
      status: "error",
      exitCode: RunEvents.ExitCode.usage,
      tokens: RunEvents.tokens(),
      cost: 0,
    })
    return RunEvents.ExitCode.usage
  }

  // Preflight the model so an unknown or disconnected one is a usage error
  // instead of a silent fallback to whichever provider has a key.
  const model = input.model && !input.reattach ? Provider.parseModel(input.model) : undefined
  if (model) {
    const providers = await sdk.provider.list()
    const provider = providers.data?.all.find((item) => item.id === model.providerID)
    const connected = providers.data?.connected.includes(model.providerID) ?? false
    if (!provider?.models[model.modelID] || !connected) {
      return usage(
        `Model ${input.model} is not available. Add your own API key (\`axiomics keys add\`) or connect a provider, then pass --model provider/model.`,
      )
    }
  }

  const agent = await (async () => {
    if (input.reattach) return
    if (!input.agent) return "research"
    const found = await Agent.get(input.agent)
    if (!found) {
      UI.println(
        UI.Style.TEXT_WARNING_BOLD + "!",
        UI.Style.TEXT_NORMAL,
        `agent "${input.agent}" not found. Falling back to default agent`,
      )
      return "research"
    }
    if (found.mode === "subagent") {
      UI.println(
        UI.Style.TEXT_WARNING_BOLD + "!",
        UI.Style.TEXT_NORMAL,
        `agent "${input.agent}" is a subagent, not a primary agent. Falling back to default agent`,
      )
      return "research"
    }
    return input.agent
  })()

  const controller = new AbortController()
  const events = await sdk.event.subscribe(undefined, { signal: controller.signal })
  let errorMsg: string | undefined
  let rejected = false
  let finished = false
  let tokens = RunEvents.tokens()
  let cost = 0
  const errored = Promise.withResolvers<void>()
  const handled = new Set<string>()
  const answered = new Set<string>()

  // The root session plus every descendant created by delegation; requests
  // from unrelated sessions on a shared server are left alone.
  const family = new Set([sessionID])
  const foreign = new Set<string>()
  const related = async (id: string): Promise<boolean> => {
    if (family.has(id)) return true
    if (foreign.has(id)) return false
    const info = await sdk.session.get({ sessionID: id }).then((result) => result.data)
    const ok = !!info?.parentID && (await related(info.parentID))
    ;(ok ? family : foreign).add(id)
    return ok
  }

  const reply = async (permission: PermissionRequest, reply: RunEvents.Permission["reply"], message?: string) => {
    await sdk.permission.reply({ requestID: permission.id, reply, message })
    const request = {
      id: permission.id,
      sessionID: permission.sessionID,
      permission: permission.permission,
      patterns: permission.patterns,
    }
    if (emit({ type: "permission", request, reply })) return
    const verdict = reply === "reject" ? "rejected" : "allowed"
    printEvent(
      UI.Style.TEXT_WARNING_BOLD,
      "Permit",
      `${verdict} ${permission.permission} ${permission.patterns.join(", ")}`,
    )
  }

  const interactive = async (permission: PermissionRequest) => {
    const result = await select({
      message: `Permission required: ${permission.permission} (${permission.patterns.join(", ")})`,
      options: [
        { value: "once", label: "Allow once" },
        { value: "session", label: "This conversation" },
        { value: "project", label: "This project" },
        { value: "always", label: "Global" },
        { value: "reject-continue", label: "Reject and continue" },
        { value: "reject", label: "Reject and stop" },
      ],
      initialValue: "once",
    }).catch(() => "reject")
    if (result === "reject-continue") {
      await reply(
        permission,
        "reject",
        "Continue without this action. Stay within the existing permissions and use the session workspace.",
      )
      return
    }
    const response = RunEvents.Permission.shape.reply.catch("reject").parse(result)
    if (response === "reject") rejected = true
    await reply(permission, response)
  }

  const permit = async (permission: PermissionRequest) => {
    if (handled.has(permission.id)) return
    handled.add(permission.id)
    if (!(await related(permission.sessionID))) return
    if (input.policy === "interactive") {
      await interactive(permission)
      return
    }
    if (input.policy === "project" && permission.permission === "external_directory") {
      await reply(
        permission,
        "reject",
        "External directories are unavailable in this unattended project run. Use files in the current project and scientific_capability for managed runtimes.",
      )
      return
    }
    // Policy replies are per request and never persisted.
    if (input.policy === "deny") rejected = true
    await reply(permission, input.policy === "deny" ? "reject" : "once")
  }

  const answer = async (question: { id: string; sessionID: string }) => {
    if (answered.has(question.id)) return
    answered.add(question.id)
    if (!(await related(question.sessionID))) return
    await sdk.question.reject({ requestID: question.id })
    rejected = true
    if (!json) printEvent(UI.Style.TEXT_WARNING_BOLD, "Question", "rejected (axiomics run cannot answer questions)")
  }

  // Track per-part text already written so we can stream append-only
  // deltas to stdout instead of waiting for part.time.end.
  const textBuffers = new Map<string, string>()

  const processor = (async () => {
    for await (const event of events.stream) {
      if (finished) break
      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.sessionID !== sessionID) continue

        if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
          if (emit({ type: "tool_use", part })) continue
          const [tool, color] = TOOL[part.tool] ?? [part.tool, UI.Style.TEXT_INFO_BOLD]
          const title =
            (part.state.status === "completed" && part.state.title) ||
            (Object.keys(part.state.input).length > 0 ? JSON.stringify(part.state.input) : "Unknown")
          printEvent(color, tool, title)
          if (part.state.status === "error") {
            UI.println(UI.Style.TEXT_DANGER + part.state.error + UI.Style.TEXT_NORMAL)
            continue
          }
          if (part.tool === "bash" && part.state.output?.trim()) {
            UI.println()
            UI.println(part.state.output)
          }
        }

        if (part.type === "step-start") {
          if (emit({ type: "step_start", part })) continue
        }

        if (part.type === "step-finish") {
          tokens = RunEvents.add(tokens, part.tokens)
          cost += part.cost
          if (emit({ type: "step_finish", part })) continue
        }

        if (part.type === "reasoning") {
          if (part.time.end) emit({ type: "reasoning", part })
          continue
        }

        if (part.type === "text") {
          // JSON mode keeps "one event per finished part" so downstream
          // consumers don't get N partial updates per part.
          if (json) {
            if (part.time?.end) emit({ type: "text", part })
            continue
          }

          const isPiped = !process.stdout.isTTY
          const prev = textBuffers.get(part.id) ?? ""

          if (part.text.length > prev.length && part.text.startsWith(prev)) {
            if (prev.length === 0 && !isPiped) UI.println()
            process.stdout.write(part.text.slice(prev.length))
            textBuffers.set(part.id, part.text)
          } else if (part.text !== prev) {
            process.stdout.write(EOL + part.text)
            textBuffers.set(part.id, part.text)
          }

          if (part.time?.end) {
            process.stdout.write(EOL)
            if (!isPiped) UI.println()
            textBuffers.delete(part.id)
          }
        }
      }

      if (event.type === "session.error") {
        const props = event.properties
        if (props.sessionID !== sessionID || !props.error) continue
        const err = describe(props.error)
        errorMsg = errorMsg ? errorMsg + EOL + err : err
        errored.resolve()
        if (emit({ type: "error", error: props.error })) continue
        UI.error(err)
      }

      if (event.type === "session.idle" && event.properties.sessionID === sessionID) {
        break
      }

      if (
        event.type === "session.status" &&
        event.properties.sessionID === sessionID &&
        event.properties.status.type === "idle"
      ) {
        break
      }

      if (event.type === "permission.asked") {
        await permit(event.properties)
        continue
      }

      if (event.type === "question.asked") {
        await answer(event.properties)
      }
    }
  })()

  // Events preserve output detail, while status polling closes the race where
  // a very short turn becomes idle before this subscriber receives its final
  // event. Once activity is observed, wait without a task-duration limit.
  const follow = async (grace: number) => {
    const track = { active: false }
    const lost = { count: 0, message: "" }
    const deadline = Date.now() + grace
    while (true) {
      const state = await sdk.session.status()
      if (state.error) {
        lost.count++
        lost.message = describe(state.error)
        if (lost.count >= 3) {
          errorMsg = errorMsg ? errorMsg + EOL + lost.message : lost.message
          return false
        }
      }
      if (!state.error) {
        lost.count = 0
        const current = state.data?.[sessionID]
        if (current && current.type !== "idle") track.active = true
        if (track.active && (!current || current.type === "idle")) return true
        if (!track.active && Date.now() >= deadline) return false
      }
      const signal = await Promise.race([
        processor.then(() => "idle" as const),
        errored.promise.then(() => "error" as const),
        Bun.sleep(200).then(() => "tick" as const),
      ])
      if (signal === "idle") return true
      if (signal === "error") return track.active
    }
  }

  if (input.reattach) {
    const current = await sdk.session.status()
    if (current.error) {
      finished = true
      controller.abort()
      return usage(describe(current.error))
    }

    const permissions = await sdk.permission.list()
    const questions = await sdk.question.list()
    await Promise.all([...(permissions.data ?? []).map(permit), ...(questions.data ?? []).map(answer)])

    await follow(0)
    finished = true
    controller.abort()
    const status: RunEvents.Status = errorMsg ? "error" : rejected ? "rejected" : "completed"
    const code = RunEvents.ExitCode[status]
    emit({ type: "done", status, exitCode: code, tokens, cost })
    return code
  }

  const parts: RunEvents.User["parts"] = [...input.files, { type: "text", text: input.message }]
  emit({ type: "user", parts, command: input.command })

  // Auto-approve implies a single visible session: delegated children would
  // otherwise run outside the stream this run reports on.
  const delegation = input.policy === "allow" || input.policy === "project" ? false : undefined
  const result = input.command
    ? await sdk.session.command({
        sessionID,
        agent,
        model: input.model,
        command: input.command,
        arguments: input.message,
        variant: input.variant,
        delegation,
      })
    : await sdk.session.promptAsync({
        sessionID,
        agent,
        model,
        variant: input.variant,
        effort: input.effort,
        delegation,
        parts,
        ...(input.bare ? { tools: { "*": false } } : {}),
      })

  // Prompt submission is asynchronous so a long agent turn is never coupled
  // to one HTTP response. Commands still return an assistant message.
  const failed = !!result.error || (!!input.command && !result.data?.info)
  const settled = await follow(failed ? IDLE_GRACE_MS.failed : IDLE_GRACE_MS.settled)
  finished = true
  controller.abort()

  if (!settled && errorMsg) {
    await settle(errored.promise, 250)
    emit({
      type: "done",
      status: "error",
      exitCode: RunEvents.ExitCode.usage,
      tokens,
      cost,
    })
    return RunEvents.ExitCode.usage
  }

  if (failed && !settled) {
    return usage(result.error ? describe(result.error) : "The prompt failed before the session started.")
  }

  const status: RunEvents.Status = errorMsg ? "error" : rejected ? "rejected" : "completed"
  const code = RunEvents.ExitCode[status]
  emit({ type: "done", status, exitCode: code, tokens, cost })
  return code
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "send one prompt from the terminal, stream the result, and exit",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "primary agent to run (default: research)",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running axiomics server (e.g., http://localhost:4096)",
      })
      .option("reattach", {
        type: "boolean",
        describe: "observe an active --session without sending another message",
        default: false,
      })
      .option("auto-approve", {
        type: "boolean",
        alias: ["dangerously-skip-permissions"],
        describe: "approve every permission request for this run without persisting anything (disables delegation)",
      })
      .option("project-only", {
        type: "boolean",
        describe:
          "approve project-contained actions, reject external-directory access, and persist nothing (disables delegation)",
      })
      .option("deny-prompts", {
        type: "boolean",
        describe: "reject every permission request for this run (the default when stdin is not a terminal)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("effort", {
        type: "string",
        choices: ["normal", "ultra"] as const,
        default: "normal" as const,
        describe: "research effort: normal or ultra",
      })
      .option("bare", {
        type: "boolean",
        describe: "disable all tools (fast one-shot reply, useful for smoke testing)",
        default: false,
        hidden: true,
      })
  },
  handler: async (args) => {
    if ([args.autoApprove, args.projectOnly, args.denyPrompts].filter(Boolean).length > 1) {
      UI.error("--auto-approve, --project-only, and --deny-prompts are mutually exclusive")
      process.exit(RunEvents.ExitCode.usage)
    }

    const files: RunFile[] = []
    for (const filePath of args.file ?? []) {
      const resolvedPath = path.resolve(process.cwd(), filePath)
      const file = Bun.file(resolvedPath)
      const stat = await file.stat().catch(() => undefined)
      if (!stat) {
        UI.error(`File not found: ${filePath}`)
        process.exit(RunEvents.ExitCode.usage)
      }
      files.push({
        type: "file",
        url: `file://${resolvedPath}`,
        filename: path.basename(resolvedPath),
        mime: stat.isDirectory() ? "application/x-directory" : "text/plain",
      })
    }

    const message = runMessage(
      [...args.message, ...(args["--"] || [])],
      process.stdin.isTTY ? "" : await Bun.stdin.text(),
    )

    if (args.reattach && !args.session) {
      UI.error("--reattach requires --session")
      process.exit(RunEvents.ExitCode.usage)
    }

    if (args.reattach && (message.trim().length > 0 || args.command || files.length > 0)) {
      UI.error("--reattach cannot be combined with a message, --command, or --file")
      process.exit(RunEvents.ExitCode.usage)
    }

    if (!args.reattach && message.trim().length === 0 && !args.command) {
      UI.error("You must provide a message or a command")
      process.exit(RunEvents.ExitCode.usage)
    }

    const policy: RunPolicy = args.autoApprove
      ? "allow"
      : args.projectOnly
        ? "project"
        : args.denyPrompts || !process.stdin.isTTY
          ? "deny"
          : "interactive"

    const run = async (sdk: AxiomicsClient) => {
      const sessionID = await session(sdk, {
        continue: args.continue,
        session: args.session,
        title: args.title,
        message,
      })
      if (!sessionID) {
        UI.error("Session not found")
        return RunEvents.ExitCode.usage
      }
      if (args.session) {
        const found = await sdk.session.get({ sessionID })
        if (!found.data) {
          UI.error(`Session not found: ${sessionID}`)
          return RunEvents.ExitCode.usage
        }
      }
      return execute({
        sdk,
        sessionID,
        message,
        files,
        command: args.command,
        model: args.model,
        agent: args.agent,
        variant: args.variant,
        effort: args.effort,
        bare: args.bare,
        format: args.format === "json" ? "json" : "default",
        policy,
        reattach: args.reattach,
      })
    }

    if (args.attach) {
      const code = await bootstrap(process.cwd(), () =>
        run(createAxiomicsClient({ baseUrl: args.attach, directory: process.cwd() })),
      )
      process.exit(code)
    }

    const code = await bootstrap(process.cwd(), async () => {
      if (args.command && !(await Command.get(args.command))) {
        UI.error(`Command "${args.command}" not found`)
        return RunEvents.ExitCode.usage
      }
      return run(createAxiomicsClient({ baseUrl: "http://axiomics.internal", fetch: Server.internalFetch() }))
    })
    process.exit(code)
  },
})
