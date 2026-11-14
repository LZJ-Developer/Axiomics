import { createEffect, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Session } from "@axiomics/sdk/v2"
import { DataProvider } from "@axiomics/ui/context/data"
import { useDialog } from "@axiomics/ui/context/dialog"
import { createAutoScroll } from "@axiomics/ui/hooks"
import { SessionTurn } from "@axiomics/ui/session-turn"
import { IconChevronDown } from "@/atlas/shared/Icon"
import { useLanguage } from "@/context/language"
import { CompactionBoundary, compaction, handoff } from "@/pages/session-compaction"
import { bestArtifact, framePdf } from "./artifacts"
import { playback } from "./playback"
import { snapshot, type Frame, type Recording } from "./timeline"
import "./cases.css"

function control(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('input, textarea, select, button, a, summary, [contenteditable="true"], [role="dialog"]'),
  )
}

export type ReplayPlayerProps = {
  session: Session
  messages: Recording
  frames: Frame[]
  directory: string
  onOpenFile?: (path: string) => void
  /** `playhead` marks the replay opening a result by itself; a click from the
   * transcript does not carry it. */
  onOpenArtifact?: (id: string, reason?: "playhead") => void
  onResolveMedia?: (url: string) => string
  onNavigateToSession?: (id: string) => void
  /** How far the replay has advanced. Hosts that mirror the workspace need it
   * to show the state as of the playhead instead of the finished session. */
  onCursor?: (cursor: number) => void
}

/**
 * Read-only transcript player. It owns no data source: the workbench feeds it
 * SDK results, the public cases page feeds it a static fixture. Both paths use
 * the same snapshot/timeline semantics, so the replay looks identical.
 */
export function ReplayPlayer(props: ReplayPlayerProps) {
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

  const player = playback(props.frames.length)
  const scroll = createAutoScroll({
    working: () => player.state.playing,
    overflowAnchor: "dynamic",
    bottomThreshold: 24,
  })
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [view, setView] = createStore(
    snapshot(props.session, props.messages, props.frames, player.state.cursor),
  )
  const opened = new Set<string>()
  const show = (artifact: ReturnType<typeof bestArtifact>) => {
    if (!artifact) return
    props.onOpenArtifact?.(artifact.id, "playhead")
  }
  createEffect(() => {
    const cursor = player.state.cursor
    props.onCursor?.(cursor)
    scroll.prepare()
    setView(reconcile(snapshot(props.session, props.messages, props.frames, cursor)))
    const frame = requestAnimationFrame(() => scroll.settle())
    onCleanup(() => cancelAnimationFrame(frame))
  })
  createEffect((previous = 0) => {
    const tick = player.state.tick
    if (tick === previous || player.state.cursor >= props.frames.length) return tick
    const artifact = framePdf(props.frames[player.state.cursor - 1])
    const key = artifact ? `${artifact.id}:${artifact.versionID}` : undefined
    if (artifact && key && !opened.has(key)) {
      opened.add(key)
      show(artifact)
    }
    return tick
  })
  createEffect((previous = false) => {
    const complete = props.frames.length > 0 && player.state.cursor >= props.frames.length
    if (complete && !previous) show(bestArtifact(props.frames))
    return complete
  })
  const disclosure = createMemo(() => ({
    partID: props.frames[player.state.cursor - 1]?.parts.at(-1)?.id,
    revision: player.state.cursor,
  }))
  const users = createMemo(() => view.message[props.session.id].filter((message) => message.role === "user"))
  const boundary = (id: string) => compaction(view.part, id)
  const open = (id: string) => {
    const value = expanded[id]
    if (value !== undefined) return value
    const frame = props.frames[player.state.cursor - 1]
    return frame?.turn === id && !frame.done
  }
  // A jump renders new turns first and grows the transcript; scrolling in the
  // same frame lands on the old bottom, which can be thousands of pixels away
  // from the end. The second frame scrolls the content that now exists, and one
  // late pass covers turn content whose own height settles after decode (tool
  // images), which otherwise clips the last card by a few tens of pixels.
  let settleTimers: ReturnType<typeof setTimeout>[] = []
  onCleanup(() => settleTimers.forEach(clearTimeout))
  const settleBottom = () => {
    const toBottom = () => scroll.forceScrollToBottom()
    requestAnimationFrame(() => requestAnimationFrame(toBottom))
    settleTimers.forEach(clearTimeout)
    settleTimers = [setTimeout(toBottom, 180), setTimeout(toBottom, 420)]
  }
  const seek = (cursor: number) => {
    player.seek(cursor)
    settleBottom()
  }
  const step = (delta: number) => {
    player.step(delta)
    settleBottom()
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
    <section
      class="case-replay"
      data-component="case-replay"
      ref={(element) => {
        refs.root = element
        measure()
      }}
    >
      <div class="session-conversation-scroll-frame case-replay-scroll-frame">
        <div
          class="atlas-scroll atlas-chat-scroll session-scroller case-transcript"
          ref={scroll.scrollRef}
          onScroll={scroll.handleScroll}
          onClick={scroll.handleInteraction}
        >
          <div class="session-transcript w-full flex flex-col items-start justify-start" ref={scroll.contentRef}>
            <Show when={props.frames.length === 0}>
              <p class="case-replay-empty">{language.t("cases.replay.empty")}</p>
            </Show>
            <DataProvider
              data={view}
              directory={props.directory}
              onOpenFile={props.onOpenFile}
              onOpenArtifact={props.onOpenArtifact}
              onNavigateToSession={props.onNavigateToSession}
              onResolveMedia={props.onResolveMedia}
            >
              <For each={users().map((user) => user.id)}>
                {(id, index) => (
                  <div data-message-id={id} class="min-w-0 w-full max-w-full">
                    <Show
                      when={!boundary(id)}
                      fallback={
                        <CompactionBoundary
                          part={boundary(id)}
                          summary={handoff(view.message[props.session.id], view.part, id)}
                          onOpenFile={(path) => props.onOpenFile?.(path)}
                        />
                      }
                    >
                      <SessionTurn
                        sessionID={props.session.id}
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
              disabled={props.frames.length < 2}
              aria-keyshortcuts="Space Enter"
            >
              {player.state.playing
                ? language.t("cases.replay.pause")
                : player.state.cursor >= props.frames.length
                  ? language.t("cases.replay.restart")
                  : language.t("cases.replay.continue")}
            </button>
            <span class="case-player__position" aria-live="polite">
              {player.state.cursor} / {props.frames.length}
            </span>
            <div class="case-player__speeds" aria-label={language.t("cases.replay.speed")}>
              <For each={[0.5, 1, 2, 4]}>
                {(speed) => (
                  <button type="button" aria-pressed={player.state.speed === speed} onClick={() => player.speed(speed)}>
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
            min={Math.min(1, props.frames.length)}
            max={props.frames.length}
            value={player.state.cursor}
            disabled={props.frames.length < 2}
            onInput={(event) => seek(event.currentTarget.valueAsNumber)}
          />
        </footer>
      </div>
    </section>
  )
}
