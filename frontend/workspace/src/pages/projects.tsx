import { createMemo, createSignal, Show, type JSX } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@axiomics/ui/context/dialog"
import { showToast } from "@axiomics/ui/toast"
import { CommandPalette } from "@/atlas/CommandPalette"
import { DisconnectedPanel } from "@/atlas/DisconnectedPanel"
import { FdaBanner } from "@/atlas/FdaBanner"
import { HelpOverlay } from "@/atlas/HelpOverlay"
import { confirmDialog } from "@/atlas/dialogs"
import { uiStore } from "@/atlas/store/ui"
import { projectPrefs } from "@/atlas/store/projectPrefs"
import { ToastContainer } from "@/atlas/Toast"
import { useGlobalKeys } from "@/atlas/useGlobalKeys"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { DialogSettings } from "@/components/dialog-settings"
import { settingsApi } from "@/components/settings/api"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useCommand } from "@/context/command"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { ProjectsWorkbench, type HomeProject } from "./home-workbench"
import {
  filterProjects,
  launcherState,
  prepareArchivedProjects,
  prepareProjects,
  projectName,
  type ProjectRecord,
} from "./home-projects"
import { useProjectCreate } from "./project-create"
import { projectHref } from "@/utils/project-route"
import { IconBookOpen } from "@/atlas/shared/Icon"
import { useLanguage } from "@/context/language"

export { ProjectsWorkbench, type HomeProject }

/**
 * `/projects`: the project list exactly as it behaved on `/` before the
 * workbench launcher took that route — search, create, pin, archive, restore,
 * open. Opening a row is an explicit user choice, so it still unhides the
 * project; the launcher deliberately does not.
 */
export default function Projects(): JSX.Element {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const sdk = useGlobalSDK()
  const navigate = useNavigate()
  const server = useServer()
  const commands = useCommand()
  const language = useLanguage()
  const [query, setQuery] = createSignal("")
  const create = useProjectCreate(openProject)
  const projects = createMemo(() =>
    prepareProjects(sync.data.project, projectPrefs.hidden(), projectPrefs.favorites()).map((project): HomeProject => {
      const child = sync.child(project.worktree, { bootstrap: false, projectID: project.id })[0]
      if (child.status !== "complete") return project
      return { ...project, sessions: child.sessionTotal }
    }),
  )
  const archivedProjects = createMemo(() => prepareArchivedProjects(sync.data.project))
  const filtered = createMemo(() => filterProjects(projects(), query()))
  const state = createMemo(() =>
    launcherState({
      ready: sync.ready,
      healthy: server.healthy(),
      error: sync.error,
      projectCount: projects().length + archivedProjects().length,
    }),
  )
  const status = createMemo(() => {
    if (server.healthy() === true) return "healthy"
    if (server.healthy() === false) return "error"
    return "checking"
  })

  function openProject(project: ProjectRecord) {
    projectPrefs.unhide(project.id, project.worktree)
    layout.projects.open(project.worktree)
    server.projects.touch(project.id)
    navigate(projectHref(project))
  }

  function pinProject(project: ProjectRecord) {
    projectPrefs.toggleFavorite(project.id, project.worktree)
  }

  async function archiveProject(project: ProjectRecord) {
    const name = projectName(project)
    const ok = await confirmDialog(dialog, {
      title: language.t("home.archive.title", { name }),
      message: language.t("home.archive.message"),
      confirmLabel: language.t("home.archive.confirm"),
    })
    if (!ok) return
    try {
      await settingsApi<ProjectRecord>(sdk.url, platform.fetch ?? fetch, `/project/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      })
      projectPrefs.hide(project.id, project.worktree)
      layout.projects.close(project.worktree)
      showToast({ variant: "success", title: language.t("home.archive.done") })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("home.archive.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function restoreProject(project: ProjectRecord) {
    try {
      await settingsApi<ProjectRecord>(sdk.url, platform.fetch ?? fetch, `/project/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
      })
      projectPrefs.unhide(project.id, project.worktree)
      showToast({ variant: "success", title: language.t("home.restore.done", { name: projectName(project) }) })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("home.restore.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  commands.register(() => [
    {
      id: "project.create",
      title: "Create project",
      description: "Start a new research workspace",
      category: "Projects",
      onSelect: create.show,
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

  useGlobalKeys({ onNew: create.show })

  return (
    <div class="atlas-root science-home">
      <ToastContainer />
      <HelpOverlay open={uiStore.helpOpen()} onClose={() => uiStore.setHelpOpen(false)} />
      <CommandPalette open={uiStore.paletteOpen()} onClose={() => uiStore.setPaletteOpen(false)} />

      <ProjectsWorkbench
        state={state()}
        projects={filtered()}
        archivedProjects={archivedProjects()}
        totalProjects={projects().length}
        query={query()}
        refreshing={!sync.ready}
        accessory={
          <>
            <button class="science-home__button" type="button" onClick={() => navigate("/cases")}>
              <IconBookOpen size={14} strokeWidth={1.5} />
              {language.t("cases.title")}
            </button>
            <FdaBanner />
          </>
        }
        notice={
          <Show when={state() === "recent"}>
            <DisconnectedPanel />
          </Show>
        }
        serverName={server.name || "Local server"}
        serverStatus={status()}
        onQuery={setQuery}
        onOpen={openProject}
        onPin={pinProject}
        onArchive={(project) => void archiveProject(project)}
        onRestore={(project) => void restoreProject(project)}
        onCreate={create.show}
        onRetry={() => void server.refresh()}
        onSettings={() => dialog.show(() => <DialogSettings />)}
        onServer={() => dialog.show(() => <DialogSelectServer />)}
      />
    </div>
  )
}
