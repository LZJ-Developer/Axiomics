import { For, type Component } from "solid-js"
import { Wordmark } from "@/atlas/Wordmark"
import { IconChevronRight } from "@/atlas/shared/Icon"
import { deploymentCapabilities } from "@/context/capabilities"
import { useLanguage } from "@/context/language"
import type { ShowcaseCase } from "./cases/catalog"
import { starterCases } from "./session-empty-cases"
import "./session-empty.css"

/**
 * The first screen of a conversation that has no turns yet.
 *
 * The composer keeps its absolute dock and is only translated up by CSS, so
 * sending the first message flips a data attribute instead of remounting
 * PromptInput — draft attachments, the selected model, and the undo bar all
 * survive the transition.
 */
export const SessionEmptyHero: Component<{ ref?: (element: HTMLDivElement) => void }> = (props) => {
  const language = useLanguage()

  // The authenticating proxy copies the signed-in name onto the request. A
  // server reached directly reports none, and the greeting drops the name
  // rather than inventing one. Names are shown in capitals, the way the
  // account is written in the directory.
  const greeting = () => {
    const name = deploymentCapabilities.user()
    return name ? language.t("session.empty.greeting", { name: name.toUpperCase() }) : language.t("session.empty.title")
  }

  return (
    <div class="session-empty__hero" ref={props.ref}>
      <div class="session-empty__greeting">
        <Wordmark size="lg" markOnly />
        <h1 class="session-empty__heading">{greeting()}</h1>
      </div>
      <p class="session-empty__facts">{language.t("session.empty.facts")}</p>
    </div>
  )
}

/**
 * Three real cases from the showcase catalog, read as an index rather than a
 * card grid: one hairline rule per entry, the modality and tool set as a quiet
 * left column, the research question carrying the row. Clicking one drafts its
 * question into the composer; it never sends, so the first interaction costs
 * nothing and stays editable.
 */
export const SessionStarterCards: Component<{
  ref?: (element: HTMLDivElement) => void
  onPick: (item: ShowcaseCase) => void
}> = (props) => {
  const language = useLanguage()

  return (
    <div class="session-empty__cases" role="group" aria-label={language.t("session.empty.starters")} ref={props.ref}>
      <For each={starterCases()}>
        {(item) => (
          <button type="button" class="session-empty__case" onClick={() => props.onPick(item)}>
            <span class="session-empty__case-kind">{item.omics}</span>
            <span class="session-empty__case-title">{item.title}</span>
            <span class="session-empty__case-tool">{item.tool}</span>
            <IconChevronRight class="session-empty__case-icon" size={13} strokeWidth={1.5} />
          </button>
        )}
      </For>
    </div>
  )
}
