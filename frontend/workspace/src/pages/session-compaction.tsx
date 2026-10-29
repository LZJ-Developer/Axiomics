import type { Message, Part } from "@axiomics/sdk/v2"
import { Show, type JSX } from "solid-js"
import { IconChevronDown } from "@/atlas/shared/Icon"
import { useLanguage } from "@/context/language"
import "./session-compaction.css"

type Boundary = Extract<Part, { type: "compaction" }>

export function compaction(parts: Record<string, Part[]>, id: string) {
  return parts[id]?.find((part): part is Boundary => part.type === "compaction")
}

export function handoff(messages: Message[], parts: Record<string, Part[]>, id: string) {
  const message = messages.find((item) => item.role === "assistant" && item.parentID === id)
  if (!message) return
  return parts[message.id]?.find((part) => part.type === "text")?.text
}

export function CompactionBoundary(props: {
  part?: Boundary
  summary?: string
  onOpenFile: (path: string) => void
}): JSX.Element {
  const language = useLanguage()
  const detail = () => {
    if (props.part?.trigger === "overflow") return language.t("session.compaction.recovered")
    if (props.part?.auto || props.part?.trigger === "proactive") return language.t("session.compaction.automatic")
    return language.t("session.compaction.manual")
  }

  return (
    <details class="session-compaction">
      <summary>
        <span class="session-compaction__rule" aria-hidden="true" />
        <span class="session-compaction__label">
          {language.t("session.compaction.label")}
          <span>{detail()}</span>
        </span>
        <IconChevronDown size={12} strokeWidth={1.5} />
        <span class="session-compaction__rule" aria-hidden="true" />
      </summary>
      <div class="session-compaction__body">
        <Show when={props.part?.focus}>
          {(focus) => (
            <div>
              <strong>{language.t("session.compaction.focus")}</strong>
              <p>{focus()}</p>
            </div>
          )}
        </Show>
        <Show when={props.summary} fallback={<p>{language.t("session.compaction.continue")}</p>}>
          {(summary) => (
            <div>
              <strong>{language.t("session.compaction.handoff")}</strong>
              <pre>{summary()}</pre>
            </div>
          )}
        </Show>
        <Show when={props.part?.handoffFile}>
          {(path) => (
            <button type="button" class="session-compaction__file" onClick={() => props.onOpenFile(path())}>
              {language.t("session.compaction.open", { path: path() })}
            </button>
          )}
        </Show>
      </div>
    </details>
  )
}
