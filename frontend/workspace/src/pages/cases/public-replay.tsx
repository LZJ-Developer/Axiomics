import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import type { Session } from "@axiomics/sdk/v2"
import { IconArrowUp, IconBookOpen, IconResearch } from "@/atlas/shared/Icon"
import { SessionEmptyHero, SessionStarterCards } from "@/pages/session-empty"
import { useLanguage } from "@/context/language"
import { cases } from "./catalog"
import { saveDraft } from "./draft"
import { LoginDialog } from "./login-dialog"
import { ReplayPlayer } from "./player"
import { ReplayInspector, type ReplaySelection } from "./public-inspector"
import { replayArtifacts, replayFiles } from "./replay-results"
import { timeline, type Recording } from "./timeline"
import "./cases.css"
import "../session-sidebar.css"
import "../session-empty.css"
import "./public-replay.css"

type Fixture = { session: Session; recording: Recording }

/**
 * Public workspace. It is the workbench session surface with a public data
 * source: the left rail lists the showcased cases instead of personal
 * sessions, the centre plays a recorded transcript (or opens an empty
 * conversation), and the right pane previews the results saved by the point
 * the playhead has reached. The composer's place is taken by the playback bar.
 *
 * Nothing here calls a tenant API. A visitor who types a question is asked to
 * sign in at submit time, not on arrival.
 */
export default function PublicReplay(props: { caseID?: string }) {
  const language = useLanguage()
  const [loginOpen, setLoginOpen] = createSignal(false)
  const [railOpen, setRailOpen] = createSignal(false)
  const [inspectorOpen, setInspectorOpen] = createSignal(false)
  const [selection, setSelection] = createSignal<ReplaySelection>()
  const [text, setText] = createSignal("")
  const [cursor, setCursor] = createSignal(0)
  let composerInput: HTMLTextAreaElement | undefined
  // Dismissing the pane at a frame means "not now": later results in the same
  // frame must not re-open it. Advancing resets the veto.
  const [dismissedAt, setDismissedAt] = createSignal(-1)
  const item = () => {
    const id = props.caseID
    if (!id) return
    return cases.find((entry) => entry.id === id)
  }
  const [fixture] = createResource(
    () => props.caseID,
    async (id): Promise<Fixture> => {
      const response = await fetch(`/cases/replay/${encodeURIComponent(id)}.json`)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return (await response.json()) as Fixture
    },
  )
  const frames = createMemo(() => {
    const value = fixture()
    if (!value) return []
    return timeline(value.recording, value.session.revert?.messageID)
  })
  // The inspector mirrors the workspace, and the workspace shows what exists
  // now. At frame 42 of a 669-frame case, 38 of that case's results have not
  // happened yet, so only the frames already played are visible to it.
  const visibleFrames = createMemo(() => frames().slice(0, Math.max(0, cursor())))
  const progress = createMemo(() => (frames().length ? cursor() / frames().length : 0))

  // The pane is a preview, not an index: the newest result that actually
  // carries an exported body is what it opens. A PDF or archive whose bytes
  // were not exported would only show its name, so it is skipped in favour of
  // the last figure or report that can be seen.
  const previewable = () => replayArtifacts(visibleFrames()).filter((item) => item.preview).at(-1)

  const openArtifact = (id: string, reason?: "playhead") => {
    if (reason === "playhead") {
      if (dismissedAt() === cursor()) return
      const item = replayArtifacts(frames()).find((entry) => entry.id === id)
      const target = item?.preview ? item : previewable()
      if (target) setSelection({ kind: "artifact", id: target.id })
      setInspectorOpen(true)
      return
    }
    setSelection({ kind: "artifact", id })
    setInspectorOpen(true)
  }

  const showInspector = () => {
    if (!selection()) {
      const target = previewable()
      if (target) setSelection({ kind: "artifact", id: target.id })
    }
    setInspectorOpen(true)
  }
  const openFile = (path: string) => {
    setSelection({ kind: "file", path })
    setInspectorOpen(true)
  }
  const closeInspector = () => {
    setDismissedAt(cursor())
    setInspectorOpen(false)
  }

  // Switching cases starts a new recording; nothing about the old playhead
  // carries over to it.
  createEffect(() => {
    props.caseID
    setCursor(0)
    setSelection(undefined)
    setDismissedAt(-1)
    setInspectorOpen(false)
    // The hash route changes without a page load, so a dialog opened on the
    // previous view would otherwise stay in front of the next one.
    setLoginOpen(false)
  })

  // Seeking backwards unmakes results: drop a selection the playhead no longer
  // contains instead of showing a detail the transcript has not reached.
  createEffect(() => {
    const value = selection()
    if (!value) return
    const gone =
      value.kind === "artifact"
        ? !replayArtifacts(visibleFrames()).some((item) => item.id === value.id)
        : !replayFiles(visibleFrames(), fixture()?.session.directory).some((item) => item.path === value.path)
    if (gone) setSelection(undefined)
  })
  const begin = () => {
    const value = text().trim()
    if (!value) return
    // The workspace picks this up after Authelia sends the visitor back.
    saveDraft(value)
    setLoginOpen(true)
  }

  return (
    <main class="public-replay" data-view={props.caseID ? "replay" : "new"}>
      <Show when={railOpen()}>
        <button
          type="button"
          class="public-replay__backdrop"
          aria-label={language.t("cases.rail.close")}
          onClick={() => setRailOpen(false)}
        />
      </Show>

      <aside
        class="atlas-scroll session-sidebar public-replay__rail"
        data-mobile-open={railOpen() ? "true" : "false"}
        aria-label={language.t("cases.rail.label")}
        onClick={(event) => {
          if ((event.target as Element).closest("a")) setRailOpen(false)
        }}
      >
        <div class="session-sidebar__top">
          <a class="session-sidebar__project" href="#/" aria-label={language.t("cases.title")}>
            <IconBookOpen size={15} strokeWidth={1.5} />
            <strong>{language.t("cases.title")}</strong>
          </a>
        </div>

        <nav class="session-sidebar__actions" aria-label={language.t("cases.navigation")}>
          <div class="session-sidebar__action-list session-sidebar__primary-actions">
            <a
              class="session-sidebar__action session-sidebar__new"
              href="#/new"
              data-selected={props.caseID ? undefined : "true"}
            >
              <span class="session-sidebar__action-icon">
                <IconResearch size={15} strokeWidth={1.5} />
              </span>
              <span class="session-sidebar__action-copy">
                <strong>{language.t("cases.new")}</strong>
              </span>
            </a>
          </div>
        </nav>

        <div class="session-sidebar__label" id="public-replay-cases">
          {language.t("cases.rail.cases")}
        </div>
        <nav class="session-sidebar__list" aria-labelledby="public-replay-cases">
          <For each={cases}>
            {(entry) => (
              <div class="session-sidebar__session" data-active={entry.id === props.caseID ? "true" : undefined}>
                <a
                  class="session-sidebar__session-main"
                  href={`#/replay/${encodeURIComponent(entry.id)}`}
                  aria-current={entry.id === props.caseID ? "page" : undefined}
                >
                  <span class="session-sidebar__session-title">{entry.title}</span>
                </a>
              </div>
            )}
          </For>
        </nav>

        <button type="button" class="public-replay__login" onClick={() => setLoginOpen(true)}>
          {language.t("cases.rail.login")}
        </button>
      </aside>

      <div class="public-replay__main">
        <header class="public-replay__bar">
          <button
            type="button"
            class="public-replay__rail-toggle"
            aria-label={language.t("cases.rail.open")}
            onClick={() => setRailOpen(true)}
          >
            <IconBookOpen size={14} strokeWidth={1.5} />
          </button>
          <a class="public-replay__back" href="#/">
            ← {language.t("cases.title")}
          </a>
          <div class="public-replay__heading">
            <strong>{item()?.title ?? language.t("cases.new.title")}</strong>
          </div>
          <Show when={props.caseID}>
            <button
              type="button"
              class="public-replay__action"
              aria-expanded={inspectorOpen()}
              onClick={() => (inspectorOpen() ? closeInspector() : showInspector())}
            >
              {language.t("cases.inspector.results")}
            </button>
          </Show>
          <Show when={props.caseID}>
            <span class="public-replay__bar-progress" aria-hidden="true" style={{ width: `${progress() * 100}%` }} />
          </Show>
        </header>

        <Show
          when={props.caseID}
          fallback={
            <section
              id="session-conversation-panel"
              data-empty="true"
              class="public-new"
              aria-label={language.t("cases.new.label")}
            >
              <SessionEmptyHero />
              <div class="session-prompt-dock public-new__dock">
                <form
                  class="session-prompt-dock__inner public-new__composer"
                  onSubmit={(event) => {
                    event.preventDefault()
                    begin()
                  }}
                >
                  <textarea
                    ref={composerInput}
                    class="public-new__input"
                    rows={2}
                    value={text()}
                    placeholder={language.t("cases.new.placeholder")}
                    aria-label={language.t("cases.new.placeholder")}
                    autofocus
                    onInput={(event) => setText(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
                      event.preventDefault()
                      begin()
                    }}
                  />
                  <div class="public-new__foot">
                    <span class="public-new__hint">{language.t("cases.new.hint")}</span>
                    <button type="submit" class="public-new__send" disabled={!text().trim()}>
                      <IconArrowUp size={14} strokeWidth={1.6} />
                      <span class="sr-only">{language.t("cases.new.submit")}</span>
                    </button>
                  </div>
                </form>
              </div>
              <SessionStarterCards
                onPick={(item) => {
                  setText(item.question)
                  requestAnimationFrame(() => composerInput?.focus())
                }}
              />
            </section>
          }
        >
          <Show when={fixture.loading}>
            <p class="case-replay-status" role="status">
              {language.t("cases.replay.loading")}
            </p>
          </Show>
          <Show when={fixture.error}>
            <div class="case-replay-status" role="alert">
              <span>{language.t("cases.replay.error")}</span>
              <a href="#/">{language.t("cases.retry")}</a>
            </div>
          </Show>
          <Show when={fixture()} keyed>
            {(value) => (
              <ReplayPlayer
                session={value.session}
                messages={value.recording}
                frames={frames()}
                directory={value.session.directory}
                onOpenArtifact={openArtifact}
                onOpenFile={openFile}
                onCursor={setCursor}
              />
            )}
          </Show>
        </Show>
      </div>

      <Show when={props.caseID}>
        <ReplayInspector
          frames={visibleFrames()}
          directory={fixture()?.session.directory}
          selection={selection()}
          open={inspectorOpen()}
          onSelect={(value) => {
            setSelection(value)
            setInspectorOpen(true)
          }}
          onClear={() => setSelection(undefined)}
          onClose={closeInspector}
        />
      </Show>

      <LoginDialog open={loginOpen()} onClose={() => setLoginOpen(false)} />
    </main>
  )
}
