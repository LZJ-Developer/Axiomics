import { Match, Show, Switch, createEffect, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@axiomics/ui/context/dialog"
import { showToast } from "@axiomics/ui/toast"
import { CommandPalette } from "@/atlas/CommandPalette"
import { DisconnectedPanel } from "@/atlas/DisconnectedPanel"
import { HelpOverlay } from "@/atlas/HelpOverlay"
import { uiStore } from "@/atlas/store/ui"
import { projectPrefs } from "@/atlas/store/projectPrefs"
import { ToastContainer } from "@/atlas/Toast"
import { useGlobalKeys } from "@/atlas/useGlobalKeys"
import { AppHeader } from "@/atlas/AppHeader"
import { Wordmark } from "@/atlas/Wordmark"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogSettings } from "@/components/dialog-settings"
import { useCommand } from "@/context/command"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { IconBookOpen, IconLayoutGrid, IconPlus, IconSettings } from "@/atlas/shared/Icon"
import { useProjectCreate } from "./project-create"
import { launchHref, launchPhase } from "./launch-route"
import { launchProject, selectLaunch, type Launch } from "./workbench-launcher"
import type { ProjectRecord } from "./home-projects"
import "./home-workbench.css"

/**
 * `/` is the workspace launcher, not the project list (that moved to
 * `/projects`). Once the catalog is ready it enters the most recent project's
 * conversation without any further request: the project choice and the session
 * choice both come from pure helpers so Home and the project route cannot
 * disagree.
 *
 * Entering is a redirect, not a page: `replace: true` keeps the launcher out of
 * the history, so Back returns to whatever preceded it instead of bouncing
 * through the launcher again. The effect runs once per mount and stops as soon
 * as the user acts (create, project list, cases), so an in-flight catalog
 * refresh cannot yank the page out from under an open dialog.
 *
 * An account with no projects at all gets one made for it instead of a dead end
 * ("No projects yet" + a button). This is the only write on the launch path and
 * it fires at most once per mount, only after the catalog has actually loaded
 * and reported empty — a failed attempt falls back to the empty state, never a
 * retry loop. The explicit create dialog is untouched: the launcher never opens
 * it, and users still create, switch, and pin projects however they did before.
 */
export default function Home(): JSX.Element {
  const sync = useGlobalSync()
  const server = useServer()
  const layout = useLayout()
  const dialog = useDialog()
  const navigate = useNavigate()
  const commands = useCommand()
  const language = useLanguage()
  const projectCreate = useProjectCreate(enterProject)
  const [bootstrap, setBootstrap] = createStore({ state: "idle" as "idle" | "creating" | "failed" })

  const hidden = () => projectPrefs.hidden()
  const project = createMemo(() => launchProject({ projects: sync.data.project, hidden: hidden() }))
  const launch = createMemo(() =>
    selectLaunch({
      projects: sync.data.project,
      hidden: hidden(),
      sessions: knownSessions(),
    }),
  )
  const phase = createMemo(() =>
    launchPhase({ ready: sync.ready, healthy: server.healthy(), target: launch() }),
  )
  const status = createMemo(() => {
    if (server.healthy() === true) return "healthy"
    if (server.healthy() === false) return "error"
    return "checking"
  })

  // Only the chosen project's session window is read, and only when it has
  // already been fetched. Home must not bootstrap other projects to look for
  // conversations, and an absent window means "no known session", which the
  // bare project route resolves from its own fuller list.
  function knownSessions() {
    const chosen = project()
    if (!chosen) return {}
    const child = sync.child(chosen.worktree, { bootstrap: false, projectID: chosen.id })[0]
    if (child.status !== "complete") return {}
    return { [chosen.id]: child.session }
  }

  function enter(target: Launch) {
    if (target.kind === "empty") return
    const href = launchHref(target)
    if (!href) return
    layout.projects.open(target.project.worktree)
    server.projects.touch(target.project.id)
    navigate(href, { replace: true })
  }

  function enterProject(project: ProjectRecord) {
    enter({ kind: "new-session", project })
  }

  let autoLaunched = false
  let userActed = false

  function act() {
    userActed = true
  }

  // Give a brand-new account somewhere to land. The name is the same one the
  // create dialog suggests, so a user who renames it later does not have to
  // undo a name they never chose.
  function bootstrapProject() {
    setBootstrap("state", "creating")
    void projectCreate
      .create({ name: language.t("home.workbench.defaultProject"), sources: [] })
      .catch((error: unknown) => {
        setBootstrap("state", "failed")
        showToast({
          title: language.t("home.workbench.createFailed.title"),
          description: error instanceof Error ? error.message : String(error),
        })
      })
  }

  createEffect(() => {
    const target = launch()
    if (autoLaunched || userActed) return
    // `phase` is the only gate: it waits for readiness, refuses a confirmed
    // unreachable server, and never enters from an empty catalog.
    if (phase() === "launching") {
      autoLaunched = true
      enter(target)
      return
    }
    // Empty is a loaded catalog with nothing in it, so the one attempt here is
    // made against server truth rather than a cache that has not arrived yet.
    if (phase() !== "empty" || bootstrap.state !== "idle") return
    autoLaunched = true
    bootstrapProject()
  })

  function showCreateProject() {
    act()
    projectCreate.show()
  }

  const openProjects = () => {
    act()
    navigate("/projects")
  }

  const openCases = () => {
    act()
    navigate("/cases")
  }

  commands.register(() => [
    {
      id: "project.create",
      title: "Create project",
      description: "Start a new research workspace",
      category: "Projects",
      onSelect: showCreateProject,
    },
    {
      id: "project.list",
      title: "Open project list",
      description: "Browse, pin, archive, and restore projects",
      category: "Projects",
      onSelect: openProjects,
    },
    {
      id: "settings.open",
      title: "Open settings",
      description: "Configure models, capabilities, runtime, and the app",
      category: "Application",
      onSelect: () => dialog.show(() => <DialogSettings />),
    },
    {
      id: "server.switch",
      title: "Switch server",
      description: "Choose or add an Axiomics server",
      category: "Application",
      onSelect: () => dialog.show(() => <DialogSelectServer />),
    },
  ])

  useGlobalKeys({ onNew: showCreateProject })

  return (
    <div class="atlas-root science-home">
      <ToastContainer />
      <HelpOverlay open={uiStore.helpOpen()} onClose={() => uiStore.setHelpOpen(false)} />
      <CommandPalette open={uiStore.paletteOpen()} onClose={() => uiStore.setPaletteOpen(false)} />

      <div class="science-home__view">
        <AppHeader class="science-home__bar">
          <Wordmark size="sm" />
          <span class="science-home__spacer" />

          <div class="science-home__bar-actions">
            <button class="science-home__button" type="button" onClick={openProjects}>
              <IconLayoutGrid size={14} strokeWidth={1.5} />
              {language.t("cases.projects")}
            </button>
            <button class="science-home__button" type="button" onClick={openCases}>
              <IconBookOpen size={14} strokeWidth={1.5} />
              {language.t("cases.title")}
            </button>
            <button
              class="science-home__server"
              type="button"
              aria-label={server.name || "Local server"}
              title={language.t("home.workbench.server.title", { name: server.name || "Local server" })}
              onClick={() => dialog.show(() => <DialogSelectServer />)}
            >
              <span class="science-home__server-dot" data-status={status()} aria-hidden="true" />
              <span>{server.name || "Local server"}</span>
            </button>
            <span class="science-home__bar-divider" aria-hidden="true" />
            <button
              class="science-home__icon"
              type="button"
              aria-label={language.t("home.workbench.settings")}
              onClick={() => dialog.show(() => <DialogSettings />)}
            >
              <IconSettings size={15} strokeWidth={1.5} />
            </button>
          </div>
        </AppHeader>

        <Show when={phase() === "error"}>
          <DisconnectedPanel />
        </Show>

        <main class="atlas-scroll science-home__main">
          <div class="science-home__content">
            <header class="science-home__heading">
              <div class="science-home__heading-copy">
                <div class="science-home__title">
                  <h1>{language.t("cases.home")}</h1>
                </div>
                <p>{language.t("home.workbench.subtitle")}</p>
              </div>
              {/* The empty state owns the start-here actions, so the heading
                  does not repeat the primary call to action there. */}
              <Show when={phase() !== "empty"}>
                <div class="science-home__heading-actions">
                  <button
                    class="science-home__button science-home__button--primary"
                    type="button"
                    aria-label={language.t("home.workbench.newProject")}
                    onClick={showCreateProject}
                  >
                    <IconPlus size={15} strokeWidth={1.5} />
                    {language.t("home.workbench.newProject")}
                  </button>
                </div>
              </Show>
            </header>

            <Switch>
              <Match when={phase() === "loading"}>
                <section class="science-home__state" role="status" aria-live="polite">
                  <span class="science-home__spinner" aria-hidden="true" />
                  <div>
                    <strong>{language.t("home.workbench.loading.title")}</strong>
                    <span>{language.t("home.workbench.loading.description")}</span>
                  </div>
                </section>
              </Match>

              <Match when={phase() === "error"}>
                <section class="science-home__state science-home__state--error" role="alert">
                  <div>
                    <strong>{language.t("home.workbench.error.title")}</strong>
                    <span>{language.t("home.workbench.error.description")}</span>
                  </div>
                  <button class="science-home__button" type="button" onClick={() => void server.refresh()}>
                    {language.t("home.workbench.retry")}
                  </button>
                </section>
              </Match>

              <Match when={phase() === "empty" && bootstrap.state === "creating"}>
                <section class="science-home__state" role="status" aria-live="polite">
                  <span class="science-home__spinner" aria-hidden="true" />
                  <div>
                    <strong>{language.t("home.workbench.creating.title")}</strong>
                    <span>{language.t("home.workbench.creating.description")}</span>
                  </div>
                </section>
              </Match>

              <Match when={phase() === "empty"}>
                <section class="science-home__state science-home__state--empty">
                  <div>
                    <strong>{language.t("home.workbench.empty.title")}</strong>
                    <span>{language.t("home.workbench.empty.description")}</span>
                  </div>
                  <div class="science-home__heading-actions">
                    <button
                      class="science-home__button science-home__button--primary"
                      type="button"
                      aria-label={language.t("home.workbench.newProject")}
                      onClick={showCreateProject}
                    >
                      <IconPlus size={15} strokeWidth={1.5} />
                      {language.t("home.workbench.newProject")}
                    </button>
                    <button class="science-home__button" type="button" onClick={openProjects}>
                      <IconLayoutGrid size={14} strokeWidth={1.5} />
                      {language.t("cases.projects")}
                    </button>
                    <button class="science-home__button" type="button" onClick={openCases}>
                      <IconBookOpen size={14} strokeWidth={1.5} />
                      {language.t("cases.title")}
                    </button>
                  </div>
                </section>
              </Match>

              <Match when={phase() === "launching"}>
                <section class="science-home__state" role="status" aria-live="polite">
                  <span class="science-home__spinner" aria-hidden="true" />
                  <div>
                    <strong>{language.t("home.workbench.syncing")}</strong>
                    <span>{language.t("home.workbench.loading.description")}</span>
                  </div>
                </section>
              </Match>
            </Switch>
          </div>
        </main>
      </div>
    </div>
  )
}
