import { artifactTypeLabel } from "@axiomics/ui/tool-display"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { IconChevronLeft, IconX } from "@/atlas/shared/Icon"
import { useLanguage } from "@/context/language"
import { replayArtifacts, replayFiles, replayPath } from "./replay-results"
import type { Frame } from "./timeline"

export type ReplaySelection = { kind: "artifact"; id: string } | { kind: "file"; path: string }

type Preview = { kind: "image" | "text"; data: string }
type Detail = { kind: "artifact" | "file"; title: string; path: string; body?: Preview }

/**
 * The right-hand inspector of a replayed session. It mirrors the workbench
 * pane: saved results first, recorded files second, and a detail view that
 * replaces the list while something is open. All of it is read-only and fed by
 * the recording — the visitor never reaches a tenant API.
 */
export function ReplayInspector(props: {
  frames: Frame[]
  directory?: string
  selection?: ReplaySelection
  /** Narrow layouts keep the pane off-screen until asked for it. */
  open: boolean
  onSelect: (value: ReplaySelection) => void
  onClear: () => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [tab, setTab] = createSignal<"results" | "files">("results")
  const artifacts = createMemo(() => replayArtifacts(props.frames))
  const files = createMemo(() => replayFiles(props.frames, props.directory))

  createEffect(() => {
    const value = props.selection
    if (value) setTab(value.kind === "artifact" ? "results" : "files")
  })

  const detail = createMemo<Detail | undefined>(() => {
    const value = props.selection
    if (!value) return
    if (value.kind === "artifact") {
      const item = artifacts().find((entry) => entry.id === value.id)
      if (!item) return
      // Recorded paths are absolute on the machine that produced them; the
      // public page shows them relative to the project, like the transcript.
      return { kind: "artifact", title: item.title, path: replayPath(item.path, props.directory), body: item.preview }
    }
    const item = files().find((entry) => entry.path === value.path)
    if (!item) return
    const label = item.label.split("/").pop() ?? item.label
    return {
      kind: "file",
      title: label,
      path: item.label,
      body: item.content ? { kind: "text", data: item.content } : undefined,
    }
  })

  return (
    <aside
      class="public-inspector"
      data-open={props.open ? "true" : "false"}
      aria-label={language.t("cases.inspector.label")}
    >
      <Show when={props.selection} fallback={<List />}>
        <Show when={detail()} fallback={<Missing />}>
          {(value) => (
            <div class="public-inspector__detail">
              <Back />
              <header class="public-inspector__head">
                <strong>{value().title}</strong>
                <span>{value().path}</span>
              </header>
              <Show
                when={value().body}
                fallback={
                  <p class="public-inspector__empty">
                    {value().kind === "artifact"
                      ? language.t("cases.inspector.missingPreview")
                      : language.t("cases.inspector.missingContent")}
                  </p>
                }
              >
                {(body) => (
                  <Show
                    when={body().kind === "image"}
                    fallback={<pre class="public-inspector__text">{body().data}</pre>}
                  >
                    <img
                      class="public-inspector__image"
                      src={body().data}
                      alt={language.t("cases.inspector.preview")}
                    />
                  </Show>
                )}
              </Show>
            </div>
          )}
        </Show>
      </Show>
      <button
        type="button"
        class="public-inspector__close"
        aria-label={language.t("cases.inspector.close")}
        onClick={props.onClose}
      >
        <IconX size={12} strokeWidth={1.5} />
      </button>
    </aside>
  )

  function Back() {
    return (
      <button type="button" class="public-inspector__back" onClick={props.onClear}>
        <IconChevronLeft size={12} strokeWidth={1.5} />
        {language.t("cases.inspector.back")}
      </button>
    )
  }

  function Missing() {
    return (
      <div class="public-inspector__detail">
        <Back />
        <p class="public-inspector__empty">{language.t("cases.inspector.missingContent")}</p>
      </div>
    )
  }

  function List() {
    return (
      <>
        <div class="public-inspector__tabs" role="tablist" aria-label={language.t("cases.inspector.label")}>
          <button
            type="button"
            role="tab"
            aria-selected={tab() === "results"}
            data-active={tab() === "results" ? "true" : undefined}
            onClick={() => setTab("results")}
          >
            {language.t("cases.inspector.results")}
            <span>{artifacts().length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab() === "files"}
            data-active={tab() === "files" ? "true" : undefined}
            onClick={() => setTab("files")}
          >
            {language.t("cases.inspector.files")}
            <span>{files().length}</span>
          </button>
        </div>

        <Show when={tab() === "results"} fallback={<FileList />}>
          <Show
            when={artifacts().length > 0}
            fallback={<p class="public-inspector__empty">{language.t("cases.inspector.emptyResults")}</p>}
          >
            <nav class="public-inspector__list" aria-label={language.t("cases.inspector.results")}>
              <For each={artifacts()}>
                {(item) => {
                  const active = () => {
                    const value = props.selection
                    return value?.kind === "artifact" && value.id === item.id
                  }
                  return (
                    <button
                      type="button"
                      class="public-inspector__row"
                      data-active={active() ? "true" : undefined}
                      onClick={() => props.onSelect({ kind: "artifact", id: item.id })}
                    >
                      <span class="public-inspector__kind">{artifactTypeLabel(item)}</span>
                      <span class="public-inspector__copy">
                        <strong>{item.title}</strong>
                        <span>{replayPath(item.path, props.directory)}</span>
                      </span>
                    </button>
                  )
                }}
              </For>
            </nav>
          </Show>
        </Show>
      </>
    )
  }

  function FileList() {
    return (
      <Show
        when={files().length > 0}
        fallback={<p class="public-inspector__empty">{language.t("cases.inspector.emptyFiles")}</p>}
      >
        <nav class="public-inspector__list" aria-label={language.t("cases.inspector.files")}>
          <For each={files()}>
            {(item) => {
              const active = () => {
                const value = props.selection
                return value?.kind === "file" && value.path === item.path
              }
              return (
                <button
                  type="button"
                  class="public-inspector__row"
                  data-active={active() ? "true" : undefined}
                  onClick={() => props.onSelect({ kind: "file", path: item.path })}
                >
                  <span class="public-inspector__kind">{item.origin}</span>
                  <span class="public-inspector__copy">
                    <strong>{item.label.split("/").pop()}</strong>
                    <span>{item.label}</span>
                  </span>
                </button>
              )
            }}
          </For>
        </nav>
      </Show>
    )
  }
}
