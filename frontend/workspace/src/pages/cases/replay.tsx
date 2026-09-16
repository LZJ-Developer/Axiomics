import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createResource, For, onCleanup, onMount, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { DataProvider, useData } from "@axiomics/ui/context/data"
import { useDialog } from "@axiomics/ui/context/dialog"
import { createAutoScroll } from "@axiomics/ui/hooks"
import { SessionTurn } from "@axiomics/ui/session-turn"
import { IconChevronDown } from "@/atlas/shared/Icon"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { CompactionBoundary, compaction, handoff } from "@/pages/session-compaction"
import { bestArtifact, framePdf } from "./artifacts"
import { playback } from "./playback"
import { snapshot, timeline } from "./timeline"
import "./cases.css"

function control(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('input, textarea, select, button, a, summary, [contenteditable="true"], [role="dialog"]'),
  )
}

export default function CaseReplay(props: { sessionID: string }) {
  const sdk = useSDK()
  const params = useParams()
  const navigate = useNavigate()
  const data = useData()
  const dialog = useDialog()
  const language = useLanguage()
  const refs: { root?: HTMLElement; dock?: HTMLElement } = {}
  const measure = () => {
    if (!refs.root || !refs.dock) return
    const height = Math.ceil(refs.dock.getBoundingClientRect().height)
    if (height > 0) refs.root.style.setProperty("--workspace-composer-height", `${height}px`)
  }
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure)
  onCleanup(() => observer?.disconnect())
  return (
    <section
      class="case-replay"
      data-component="case-replay"
      ref={(element) => {
        refs.root = element
        measure()
      }}
    >
      <Show when={`${sdk.scope}/${props.sessionID}`} keyed>
        {(key) => <Recording key={key} />}
      </Show>
    </section>
  )

  function Recording(input: { key: string }) {
    const abort = new AbortController()
    onCleanup(() => abort.abort())
    const [recording, actions] = createResource(
      () => input.key,
      async () => {
        const results = await Promise.all([
          sdk.client.session.get({ sessionID: props.sessionID }, { signal: abort.signal }),
          sdk.client.session.messages({ sessionID: props.sessionID }, { signal: abort.signal }),
        ])
        const session = results[0].data
        const messages = results[1].data
        if (!session || !messages) throw new Error(language.t("cases.replay.unavailable"))
        return { session, messages, frames: timeline(messages, session.revert?.messageID) }
      },
    )
    const value = () => (recording.error ? undefined : recording())
    return (
      <>
        <Show when={recording.loading}>
          <p class="case-replay-status" role="status">
            {language.t("cases.replay.loading")}
          </p>
        </Show>
        <Show when={recording.error}>
          <div class="case-replay-status" role="alert">
            <span>{language.t("cases.replay.error")}</span>
            <button type="button" onClick={() => actions.refetch()}>
              {language.t("cases.retry")}
            </button>
          </div>
        </Show>
        <Show when={!recording.loading && value()} keyed>
          {(recorded) => {
            const player = playback(recorded.frames.length)
            const scroll = createAutoScroll({
              working: () => player.state.playing,
              overflowAnchor: "dynamic",
              bottomThreshold: 24,
            })
            const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
            const [view, setView] = createStore(
              snapshot(recorded.session, recorded.messages, recorded.frames, player.state.cursor),
            )
            const opened = new Set<string>()
            const show = (artifact: ReturnType<typeof bestArtifact>) => {
              if (!artifact) return
              data.openArtifact?.(artifact.id)
            }
            createEffect(() => {
              const cursor = player.state.cursor
              scroll.prepare()
              setView(reconcile(snapshot(recorded.session, recorded.messages, recorded.frames, cursor)))
              const frame = requestAnimationFrame(() => scroll.settle())
              onCleanup(() => cancelAnimationFrame(frame))
            })
            createEffect((previous = 0) => {
              const tick = player.state.tick
              if (tick === previous || player.state.cursor >= recorded.frames.length) return tick
              const artifact = framePdf(recorded.frames[player.state.cursor - 1])
              const key = artifact ? `${artifact.id}:${artifact.versionID}` : undefined
              if (artifact && key && !opened.has(key)) {
                opened.add(key)
                show(artifact)
              }
              return tick
            })
            createEffect((previous = false) => {
              const complete = recorded.frames.length > 0 && player.state.cursor >= recorded.frames.length
              if (complete && !previous) show(bestArtifact(recorded.frames))
              return complete
            })
            const disclosure = createMemo(() => ({
              partID: recorded.frames[player.state.cursor - 1]?.parts.at(-1)?.id,
              revision: player.state.cursor,
            }))
            const users = createMemo(() =>
              view.message[recorded.session.id].filter((message) => message.role === "user"),
            )
            const boundary = (id: string) => compaction(view.part, id)
            const open = (id: string) => {
              const value = expanded[id]
              if (value !== undefined) return value
              const frame = recorded.frames[player.state.cursor - 1]
              return frame?.turn === id && !frame.done
            }
            const seek = (cursor: number) => {
              player.seek(cursor)
              requestAnimationFrame(() => scroll.forceScrollToBottom())
            }
            const step = (delta: number) => {
              player.step(delta)
              requestAnimationFrame(() => scroll.forceScrollToBottom())
            }
            const keydown = (event: KeyboardEvent) => {
              if (event.defaultPrevented || event.isComposing || dialog.active) return
              if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
              const target = event.target
              const local = target === document.body || (target instanceof Node && refs.root?.contains(target))
              if (!local || control(target)) return
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault()
                step(event.key === "ArrowLeft" ? -1 : 1)
                return
              }
              if (event.key !== " " && event.key !== "Enter") return
              if (event.repeat) return
              event.preventDefault()
              player.toggle()
            }
            onMount(() => window.addEventListener("keydown", keydown))
            onCleanup(() => window.removeEventListener("keydown", keydown))
            return (
              <>
                <div class="session-conversation-scroll-frame case-replay-scroll-frame">
                  <div
                    class="atlas-scroll atlas-chat-scroll session-scroller case-transcript"
                    ref={scroll.scrollRef}
                    onScroll={scroll.handleScroll}
                    onClick={scroll.handleInteraction}
                  >
                    <div
                      class="session-transcript w-full flex flex-col items-start justify-start"
                      ref={scroll.contentRef}
                    >
                      <Show when={recorded.frames.length === 0}>
                        <p class="case-replay-empty">{language.t("cases.replay.empty")}</p>
                      </Show>
                      <DataProvider
                        data={view}
                        directory={sdk.directory}
                        onOpenFile={data.openFile}
                        onOpenArtifact={data.openArtifact}
                        onNavigateToSession={(id) => navigate(`/${params.dir}/session/${id}?replay=1`)}
                        onResolveMedia={data.mediaUrl}
                      >
                        <For each={users().map((user) => user.id)}>
                          {(id, index) => (
                            <div data-message-id={id} class="min-w-0 w-full max-w-full">
                              <Show
                                when={!boundary(id)}
                                fallback={
                                  <CompactionBoundary
                                    part={boundary(id)}
                                    summary={handoff(view.message[recorded.session.id], view.part, id)}
                                    onOpenFile={(path) => data.openFile?.(path)}
                                  />
                                }
                              >
                                <SessionTurn
                                  sessionID={recorded.session.id}
                                  messageID={id}
                                  lastUserMessageID={users().at(-1)?.id}
                                  stepsExpanded={open(id)}
                                  disclosure={disclosure()}
                                  onStepsExpandedToggle={() => setExpanded(id, !open(id))}
                                  classes={{
                                    root: "min-w-0 w-full relative",
                                    content: "flex flex-col justify-between !overflow-visible",
                                    container: "w-full px-4 md:px-5",
                                  }}
                                />
                              </Show>
                              <Show when={index() < users().length - 1 && !boundary(id)}>
                                <div class="session-turn-divider" />
                              </Show>
                            </div>
                          )}
                        </For>
                      </DataProvider>
                    </div>
                  </div>
                  <div class="session-jump-latest-rail" aria-live="polite">
                    <Show when={scroll.userScrolled()}>
                      <button
                        type="button"
                        class="session-jump-latest"
                        onClick={scroll.resume}
                        title={language.t("cases.replay.current")}
                      >
                        <IconChevronDown size={13} strokeWidth={1.6} />
                        {language.t("cases.replay.current")}
                      </button>
                    </Show>
                  </div>
                </div>
                <div
                  class="session-prompt-dock case-player-dock"
                  ref={(element) => {
                    refs.dock = element
                    observer?.observe(element)
                    measure()
                  }}
                >
                  <footer class="session-prompt-dock__inner case-player" aria-label={language.t("cases.replay.label")}>
                    <div class="case-player__controls">
                      <button
                        type="button"
                        class="case-player__toggle"
                        onClick={player.toggle}
                        disabled={recorded.frames.length < 2}
                        aria-keyshortcuts="Space Enter"
                      >
                        {player.state.playing
                          ? language.t("cases.replay.pause")
                          : player.state.cursor >= recorded.frames.length
                            ? language.t("cases.replay.restart")
                            : language.t("cases.replay.continue")}
                      </button>
                      <span class="case-player__position" aria-live="polite">
                        {player.state.cursor} / {recorded.frames.length}
                      </span>
                      <div class="case-player__speeds" aria-label={language.t("cases.replay.speed")}>
                        <For each={[0.5, 1, 2, 4]}>
                          {(speed) => (
                            <button
                              type="button"
                              aria-pressed={player.state.speed === speed}
                              onClick={() => player.speed(speed)}
                            >
                              {speed}×
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                    <input
                      class="case-player__progress"
                      type="range"
                      aria-label={language.t("cases.replay.progress")}
                      aria-keyshortcuts="ArrowLeft ArrowRight"
                      min={Math.min(1, recorded.frames.length)}
                      max={recorded.frames.length}
                      value={player.state.cursor}
                      disabled={recorded.frames.length < 2}
                      onInput={(event) => seek(event.currentTarget.valueAsNumber)}
                    />
                  </footer>
                </div>
              </>
            )
          }}
        </Show>
      </>
    )
  }
}
