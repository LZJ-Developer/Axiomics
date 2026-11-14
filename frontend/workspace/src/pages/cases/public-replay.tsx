import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import type { Session } from "@axiomics/sdk/v2"
import { Button } from "@axiomics/ui/button"
import { Icon } from "@axiomics/ui/icon"
import { IconButton } from "@axiomics/ui/icon-button"
import {
  IconBookOpen,
  IconChevronDown,
  IconChevronLeft,
  IconHome,
  IconMessageSquare,
  IconPlus,
  IconResearch,
  IconSearch,
  IconSettings,
} from "@/atlas/shared/Icon"
import { ComposerShell } from "@/components/composer-shell"
import { SessionEmptyHero, SessionStarterCards } from "@/pages/session-empty"
import { SessionSidebarActions, SidebarAction } from "@/pages/session-sidebar-action"
import { SessionTabStrip } from "@/pages/session-tabs"
import "@/components/model-settings-popover.css"
import "@/components/prompt-input.css"
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
  // A resource that failed throws its error into the nearest error boundary
  // the moment its value is read, which on this public entry replaces the whole
  // page with the workspace recovery screen. A case id that does not exist is
  // an ordinary dead link, so the value is read only after the request settled
  // without an error; the error branch below owns that state.
  const loaded = () => (fixture.loading || fixture.error ? undefined : fixture())
  const frames = createMemo(() => {
    const value = loaded()
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
        : !replayFiles(visibleFrames(), loaded()?.session.directory).some((item) => item.path === value.path)
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
        <Show
          when={!props.caseID}
          fallback={
            <>
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
                    <div
                      class="session-sidebar__session"
                      data-active={entry.id === props.caseID ? "true" : undefined}
                    >
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
            </>
          }
        >
          <div class="session-sidebar__top">
            <a class="session-sidebar__project" href="#/" aria-label={language.t("cases.title")}>
              <IconHome size={15} strokeWidth={1.5} />
              <strong>{language.t("cases.title")}</strong>
              <IconChevronDown class="session-sidebar__project-chevron" size={12} strokeWidth={1.5} />
            </a>
          </div>

          <nav class="session-sidebar__actions" aria-label={language.t("workspace.sidebar.navigation")}>
            <div class="session-sidebar__action-list session-sidebar__primary-actions">
              <SidebarAction
                class="session-sidebar__new"
                label={language.t("workspace.sidebar.new")}
                detail={language.t("workspace.sidebar.newDetail")}
                ariaLabel={language.t("workspace.sidebar.newAria")}
                shortcut="⌘N"
                onClick={() => setLoginOpen(true)}
              >
                <IconPlus size={15} strokeWidth={1.7} />
              </SidebarAction>
              <SidebarAction
                label={language.t("workspace.sidebar.search")}
                detail={language.t("workspace.sidebar.searchDetail")}
                ariaLabel={language.t("workspace.sidebar.searchAria")}
                shortcut="⌘K"
                onClick={() => setLoginOpen(true)}
              >
                <IconSearch size={15} strokeWidth={1.5} />
              </SidebarAction>
              <SidebarAction
                label={language.t("workspace.sidebar.customize")}
                detail={language.t("workspace.sidebar.customizeDetail")}
                ariaLabel={language.t("workspace.sidebar.customizeAria")}
                onClick={() => setLoginOpen(true)}
              >
                <IconSettings size={15} strokeWidth={1.5} />
              </SidebarAction>
            </div>

            <SessionSidebarActions
              context="files"
              contextOpen={false}
              terminal={false}
              onContext={() => setLoginOpen(true)}
              copy={{
                workspace: language.t("workspace.sidebar.workspace"),
                files: language.t("workspace.sidebar.files"),
                projectFiles: language.t("workspace.sidebar.projectFiles"),
                openFiles: language.t("workspace.sidebar.openFiles"),
                terminal: language.t("workspace.sidebar.terminal"),
                projectShell: language.t("workspace.sidebar.projectShell"),
                openTerminal: language.t("workspace.sidebar.openTerminal"),
                compute: language.t("workspace.sidebar.compute"),
                computeDetail: language.t("workspace.sidebar.computeDetail"),
                openCompute: language.t("workspace.sidebar.openCompute"),
              }}
            />
          </nav>

          <div class="session-sidebar__label" id="public-replay-sessions">
            {language.t("workspace.sidebar.sessions")}
          </div>
          <nav class="session-sidebar__list" aria-labelledby="public-replay-sessions">
            <div class="session-sidebar__empty">{language.t("workspace.sidebar.empty")}</div>
          </nav>
        </Show>

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
            <IconMessageSquare size={14} strokeWidth={1.5} />
          </button>
          <Show
            when={props.caseID}
            fallback={
              <>
                <a class="public-replay__back" href="#/" aria-label={language.t("cases.title")}>
                  <IconChevronLeft size={14} strokeWidth={1.6} />
                </a>
                <div class="public-replay__tabs">
                  <SessionTabStrip
                    t={language.t}
                    tabs={[
                      {
                        id: "new",
                        title: language.t("session.new.title"),
                        working: false,
                        dirty: false,
                        unread: false,
                        editable: false,
                        closable: false,
                        reorderable: false,
                      },
                    ]}
                    active="new"
                    onSelect={() => undefined}
                    onClose={() => undefined}
                    onReorder={() => undefined}
                    onRename={async () => false}
                  />
                </div>
              </>
            }
          >
            <a class="public-replay__back" href="#/">
              ← {language.t("cases.title")}
            </a>
            <div class="public-replay__heading">
              {/* A dead case link has no catalog entry: "untitled session" reads
                  with the load-failed body below, where "start a new research"
                  would describe a page the visitor never asked for. */}
              <strong>{item()?.title ?? language.t("cases.untitled")}</strong>
            </div>
            <button
              type="button"
              class="public-replay__action"
              aria-expanded={inspectorOpen()}
              onClick={() => (inspectorOpen() ? closeInspector() : showInspector())}
            >
              {language.t("cases.inspector.results")}
            </button>
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
              <SessionEmptyHero anonymousGreeting="Hi" />
              <div class="session-prompt-dock public-new__dock">
                <div class="session-prompt-dock__inner">
                  <ComposerShell
                    onSubmit={(event) => {
                      event.preventDefault()
                      begin()
                    }}
                    editor={
                      <textarea
                        ref={composerInput}
                        data-component="prompt-input"
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
                    }
                    footer={
                      <>
                        <div
                          class="workspace-composer__controls"
                          role="group"
                          aria-label={language.t("prompt.aria.composerTools")}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            class="workspace-composer__attach shrink-0"
                            onClick={() => setLoginOpen(true)}
                            aria-label={language.t("prompt.action.attachFile")}
                          >
                            <Icon name="paperclip" class="size-4" />
                          </Button>
                          <button
                            type="button"
                            class="public-new__tools"
                            onClick={() => setLoginOpen(true)}
                            aria-label={language.t("prompt.tools")}
                          >
                            <span>{language.t("prompt.tools")}</span>
                            <Icon name="chevron-down" size="small" />
                          </button>
                        </div>
                        <div
                          class="workspace-composer__actions"
                          role="group"
                          aria-label={language.t("prompt.aria.modelEffortSend")}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            data-model-settings-trigger
                            data-model-settings-trigger-style="label"
                            class="min-w-0"
                            onClick={() => setLoginOpen(true)}
                          >
                            <span class="truncate">{language.t("prompt.setup.title")}</span>
                            <Icon name="chevron-down" size="small" class="shrink-0 text-text-weak" />
                          </Button>
                          <IconButton
                            type="submit"
                            disabled={!text().trim()}
                            icon="arrow-up"
                            variant="primary"
                            class="workspace-composer__send rounded-full"
                            aria-label={language.t("prompt.action.send")}
                          />
                        </div>
                      </>
                    }
                  />
                </div>
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
          <Show when={loaded()} keyed>
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
          directory={loaded()?.session.directory}
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
