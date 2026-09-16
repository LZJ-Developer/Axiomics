import type { AssistantMessage, Session, ToolPart, UserMessage } from "@axiomics/sdk/v2"
import type { Recording } from "./timeline"

export function recording() {
  const session: Session = {
    id: "ses_replay",
    slug: "replay",
    projectID: "prj_replay",
    directory: "/research",
    title: "Recorded run",
    version: "1",
    time: { created: 1, updated: 20 },
  }
  const user = (id: string): UserMessage => ({
    id,
    sessionID: session.id,
    role: "user",
    time: { created: 1 },
    agent: "research",
    model: { providerID: "test", modelID: "test" },
    summary: { diffs: [{ file: "answer.txt", before: "", after: "done", additions: 1, deletions: 0 }] },
  })
  const assistant = (id: string, parentID: string): AssistantMessage => ({
    id,
    parentID,
    sessionID: session.id,
    role: "assistant",
    time: { created: 2, completed: 20 },
    modelID: "test",
    providerID: "test",
    agent: "research",
    mode: "research",
    path: { cwd: "/research", root: "/research" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    finish: "stop",
  })
  const tool = (id: string, messageID: string, name: string): ToolPart => ({
    id,
    messageID,
    sessionID: session.id,
    type: "tool",
    callID: `call_${id}`,
    tool: name,
    state: {
      status: "completed",
      input: { description: "Inspect the experiment" },
      output: "Recorded output",
      title: "Experiment",
      metadata: { artifact: { kind: "table", data: { rows: [[1]] } } },
      time: { start: 2, end: 3 },
    },
  })
  const task = tool("prt_task", "msg_002", "task")
  const artifact = tool("prt_artifact", "msg_002", "science_table")
  const failure = tool("prt_failure", "msg_004", "bash")
  failure.state = {
    status: "error",
    input: { command: "bad-command" },
    error: "Recorded tool failure",
    time: { start: 4, end: 5 },
  }
  const failed = assistant("msg_004", "msg_003")
  failed.error = { name: "UnknownError", data: { message: "Recorded provider failure" } }
  const messages: Recording = [
    {
      info: user("msg_001"),
      parts: [
        { id: "prt_question", messageID: "msg_001", sessionID: session.id, type: "text", text: "First question" },
      ],
    },
    {
      info: assistant("msg_002", "msg_001"),
      parts: [
        { id: "prt_start", messageID: "msg_002", sessionID: session.id, type: "step-start" },
        {
          id: "prt_empty",
          messageID: "msg_002",
          sessionID: session.id,
          type: "reasoning",
          text: " ",
          time: { start: 1, end: 2 },
        },
        task,
        artifact,
        { id: "prt_answer", messageID: "msg_002", sessionID: session.id, type: "text", text: "Final answer" },
      ],
    },
    {
      info: user("msg_003"),
      parts: [
        { id: "prt_followup", messageID: "msg_003", sessionID: session.id, type: "text", text: "Later question" },
      ],
    },
    { info: failed, parts: [failure] },
  ]
  return { session, messages, task, artifact, failure }
}
