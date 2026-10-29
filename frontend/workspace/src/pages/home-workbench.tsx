import { For, Match, Show, Switch, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { DateTime } from "luxon"
import { AppHeader } from "@/atlas/AppHeader"
import {
  IconArchive,
  IconChevronRight,
  IconPin,
  IconPinFilled,
  IconPlus,
  IconSearch,
  IconSettings,
  IconX,
} from "@/atlas/shared/Icon"
import { Wordmark } from "@/atlas/Wordmark"
import { useLanguage } from "@/context/language"
import { projectName, type LauncherState, type PreparedProject } from "./home-projects"
import { preloadSession } from "./session-loader"
import "./home-workbench.css"

export type HomeProject = PreparedProject & {
  sessions?: number
}

export function ProjectsWorkbench(props: {
  state: LauncherState
  projects: HomeProject[]
  archivedProjects: HomeProject[]
  totalProjects: number
  query: string
  refreshing?: boolean
  accessory?: JSX.Element
  notice?: JSX.Element
  serverName: string
  serverStatus: "checking" | "healthy" | "error"
  onQuery: (query: string) => void
  onOpen: (project: HomeProject) => void
  onPin: (project: HomeProject) => void
  onArchive: (project: HomeProject) => void
  onRestore: (project: HomeProject) => void
  onCreate: () => void
  onRetry: () => void
  onSettings: () => void
  onServer: () => void
}): JSX.Element {
  const language = useLanguage()
  const recent = () => props.state === "recent"
  const [clock, setClock] = createStore({ now: Date.now() })
  onMount(() => {
    const refresh = () => setClock("now", Date.now())
    const interval = setInterval(refresh, 60_000)
    document.addEventListener("visibilitychange", refresh)
    onCleanup(() => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", refresh)
    })
  })
  let input: HTMLInputElement | undefined

  const clearSearch = () => {
    props.onQuery("")
    input?.focus()
  }

  const countLabel = () => {
    const total = props.totalProjects
    const single = total === 1
    if (props.query.trim())
      return language.t(single ? "home.workbench.countFiltered.one" : "home.workbench.countFiltered.many", {
        shown: props.projects.length,
        total,
      })
    return language.t(single ? "home.workbench.count.one" : "home.workbench.count.many", { count: total })
  }

  const activityLabel = (project: HomeProject) => {
    // A server clock ahead of this browser would make Luxon phrase the age as
    // "in 3 seconds"; under a minute (or in the future) is simply "just now".
    const elapsed = clock.now - project.updatedAt
    const relative =
      elapsed < 60_000
        ? language.t("home.workbench.activity.justNow")
        : (DateTime.fromMillis(project.updatedAt).toRelative({ base: DateTime.fromMillis(clock.now) }) ??
          language.t("home.workbench.activity.recently"))
    const action = language.t(
      (project.time.activity ?? 0) > project.time.created
        ? "home.workbench.activity.active"
        : "home.workbench.activity.created",
    )
    return language.t("home.workbench.activity", { action, relative })
  }

  return (
    <div class="science-home__view">
      <AppHeader class="science-home__bar">
        <Wordmark size="sm" />
        <span class="science-home__spacer" />

        <div class="science-home__bar-actions">
          {props.accessory}
          <button
            class="science-home__server"
            type="button"
            aria-label={props.serverName}
            title={language.t("home.workbench.server.title", { name: props.serverName })}
            onClick={props.onServer}
          >
            <span class="science-home__server-dot" data-status={props.serverStatus} aria-hidden="true" />
            <span>{props.serverName}</span>
          </button>
          <span class="science-home__bar-divider" aria-hidden="true" />
          <button
            class="science-home__icon"
            type="button"
            aria-label={language.t("home.workbench.settings")}
            onClick={props.onSettings}
          >
            <IconSettings size={15} strokeWidth={1.5} />
          </button>
        </div>
      </AppHeader>

      {props.notice}

      <main class="atlas-scroll science-home__main">
        <div class="science-home__content">
          <header class="science-home__heading">
            <div class="science-home__heading-copy">
              <div class="science-home__title">
                <h1 id="science-home-projects-title">{language.t("home.workbench.title")}</h1>
                <Show when={recent() && props.refreshing}>
                  <span class="science-home__refreshing" role="status">
                    {language.t("home.workbench.syncing")}
                  </span>
                </Show>
              </div>
              <p>{language.t("home.workbench.subtitle")}</p>
            </div>
            <div class="science-home__heading-actions">
              <button
                class="science-home__button science-home__button--primary"
                type="button"
                aria-label={language.t("home.workbench.newProject")}
                onClick={props.onCreate}
              >
                <IconPlus size={15} strokeWidth={1.5} />
                {language.t("home.workbench.newProject")}
              </button>
            </div>
          </header>

          <Show when={recent()}>
            <div class="science-home__toolbar" aria-label={language.t("home.workbench.controls")}>
              <label class="science-home__search" for="science-home-project-search">
                <IconSearch size={16} strokeWidth={1.45} />
                <input
                  ref={input}
                  id="science-home-project-search"
                  type="search"
                  aria-label={language.t("home.workbench.searchAria")}
                  aria-controls="science-home-project-list"
                  value={props.query}
                  placeholder={language.t("home.workbench.searchPlaceholder")}
                  onInput={(event) => props.onQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return
                    props.onQuery("")
                  }}
                />
                <Show when={props.query}>
                  <button type="button" aria-label={language.t("home.workbench.searchClear")} onClick={clearSearch}>
                    <IconX size={13} strokeWidth={1.55} />
                  </button>
                </Show>
              </label>
              <span class="science-home__results-summary sr-only" role="status" aria-live="polite">
                {countLabel()}
              </span>
            </div>
          </Show>

          <Switch>
            <Match when={props.state === "loading"}>
              <section class="science-home__state" role="status" aria-live="polite">
                <span class="science-home__spinner" aria-hidden="true" />
                <div>
                  <strong>{language.t("home.workbench.loading.title")}</strong>
                  <span>{language.t("home.workbench.loading.description")}</span>
                </div>
              </section>
            </Match>

            <Match when={props.state === "error"}>
              <section class="science-home__state science-home__state--error" role="alert">
                <div>
                  <strong>{language.t("home.workbench.error.title")}</strong>
                  <span>{language.t("home.workbench.error.description")}</span>
                </div>
                <button class="science-home__button" type="button" onClick={props.onRetry}>
                  {language.t("home.workbench.retry")}
                </button>
              </section>
            </Match>

            <Match when={props.state === "empty"}>
              <section class="science-home__state science-home__state--empty">
                <div>
                  <strong>{language.t("home.workbench.empty.title")}</strong>
                  <span>{language.t("home.workbench.empty.description")}</span>
                </div>
              </section>
            </Match>

            <Match when={props.state === "recent"}>
              <Show
                when={props.projects.length > 0}
                fallback={
                  <Show
                    when={props.query.trim()}
                    fallback={
                      <section
                        id="science-home-project-list"
                        class="science-home__state science-home__state--empty"
                        aria-live="polite"
                      >
                        <div>
                          <strong>{language.t("home.workbench.noActive.title")}</strong>
                          <span>{language.t("home.workbench.noActive.description")}</span>
                        </div>
                      </section>
                    }
                  >
                    <section
                      id="science-home-project-list"
                      class="science-home__state science-home__state--empty"
                      aria-live="polite"
                    >
                      <div>
                        <strong>{language.t("home.workbench.noMatch.title")}</strong>
                        <span>{language.t("home.workbench.noMatch.description", { query: props.query.trim() })}</span>
                      </div>
                      <button class="science-home__button" type="button" onClick={clearSearch}>
                        {language.t("home.workbench.clearSearch")}
                      </button>
                    </section>
                  </Show>
                }
              >
                <ul
                  id="science-home-project-list"
                  class="science-home__projects"
                  aria-labelledby="science-home-projects-title"
                >
                  <For each={props.projects}>
                    {(project) => (
                      <li class="science-home__project-row" data-pinned={project.pinned ? "true" : undefined}>
                        <button
                          class="science-home__project"
                          type="button"
                          data-project={project.id}
                          title={language.t("home.workbench.open", { name: projectName(project) })}
                          onPointerEnter={preloadSession}
                          onFocus={preloadSession}
                          onClick={() => props.onOpen(project)}
                        >
                          <span class="science-home__project-copy">
                            <strong>{projectName(project)}</strong>
                            <span class="science-home__project-meta">
                              <Show when={project.sessions !== undefined}>
                                <span class="science-home__sessions">
                                  {language.t(
                                    project.sessions === 1
                                      ? "home.workbench.sessionCount.one"
                                      : "home.workbench.sessionCount.many",
                                    { count: project.sessions ?? 0 },
                                  )}
                                </span>
                                <span class="science-home__meta-separator" aria-hidden="true">
                                  ·
                                </span>
                              </Show>
                              <time
                                datetime={DateTime.fromMillis(project.updatedAt).toISO() ?? undefined}
                                title={language.t("home.workbench.lastActivity")}
                              >
                                {activityLabel(project)}
                              </time>
                            </span>
                          </span>
                        </button>
                        <div class="science-home__project-actions">
                          <button
                            class="science-home__project-action science-home__project-pin"
                            type="button"
                            aria-label={language.t(project.pinned ? "home.workbench.unpin" : "home.workbench.pin", {
                              name: projectName(project),
                            })}
                            aria-pressed={project.pinned}
                            title={language.t(
                              project.pinned ? "home.workbench.unpinProject" : "home.workbench.pinProject",
                            )}
                            onClick={() => props.onPin(project)}
                          >
                            <Show when={project.pinned} fallback={<IconPin size={15} strokeWidth={1.4} />}>
                              <IconPinFilled size={15} strokeWidth={1.4} />
                            </Show>
                          </button>
                          <button
                            class="science-home__project-action science-home__project-archive"
                            type="button"
                            aria-label={language.t("home.workbench.archive", { name: projectName(project) })}
                            title={language.t("home.workbench.archiveProject")}
                            onClick={() => props.onArchive(project)}
                          >
                            <IconArchive size={14} strokeWidth={1.4} />
                          </button>
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={props.archivedProjects.length > 0}>
                <details class="science-home__archived">
                  <summary>
                    <IconArchive size={14} strokeWidth={1.45} />
                    <span>{language.t("home.workbench.archived")}</span>
                    <span class="science-home__archived-count">{props.archivedProjects.length}</span>
                    <IconChevronRight class="science-home__archived-chevron" size={12} strokeWidth={1.45} />
                  </summary>
                  <ul aria-label={language.t("home.workbench.archivedProjects")}>
                    <For each={props.archivedProjects}>
                      {(project) => (
                        <li>
                          <span>{projectName(project)}</span>
                          <button type="button" onClick={() => props.onRestore(project)}>
                            {language.t("home.workbench.restore")}
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </details>
              </Show>
            </Match>
          </Switch>
        </div>
      </main>
    </div>
  )
}
