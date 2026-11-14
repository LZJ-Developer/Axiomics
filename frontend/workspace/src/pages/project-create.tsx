import { createStore } from "solid-js/store"
import type { JSX } from "solid-js"
import { useDialog } from "@axiomics/ui/context/dialog"
import { showToast } from "@axiomics/ui/toast"
import { FolderPicker } from "@/atlas/FolderPicker"
import { DialogCreateProject, type ProjectCreateInput } from "@/components/dialog-create-project"
import { settingsApi } from "@/components/settings/api"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { NativeDirectoryPickerUnavailable } from "@/utils/native-picker"
import type { ProjectRecord } from "./home-projects"

/**
 * The create-project dialog flow, shared by the workbench launcher and the
 * project list so both entry points cannot drift (draft handling, the native
 * folder picker fallback, and the POST all live here).
 *
 * Creating is always user-initiated: the hook only opens the dialog when the
 * caller asks for it, and it never creates a project on its own. The caller
 * decides what happens to the returned project — both current callers open it.
 */
export function useProjectCreate(onCreated: (project: ProjectRecord) => void) {
  const dialog = useDialog()
  const platform = usePlatform()
  const server = useServer()
  const sdk = useGlobalSDK()
  const language = useLanguage()
  const [draft, setDraft] = createStore({ name: "", sources: [] as string[] })

  const mergeSources = (result: string | string[] | null) => {
    const paths = Array.isArray(result) ? result : result ? [result] : []
    if (paths.length === 0) return
    setDraft("sources", (current) => [...new Set([...current, ...paths])].slice(0, 10))
  }

  async function chooseSources() {
    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform
        .openDirectoryPickerDialog({ title: "Add source folders", multiple: true, serverUrl: sdk.url })
        .catch((error) => {
          if (!(error instanceof NativeDirectoryPickerUnavailable)) {
            showToast({
              title: "The system folder picker could not open",
              description: error instanceof Error ? error.message : String(error),
            })
          }
          return undefined
        })
      if (result !== undefined) {
        mergeSources(result)
        return
      }
    }

    const selection = { result: null as string | string[] | null }
    dialog.show(
      () => (
        <FolderPicker
          multiple
          t={language.t}
          title={language.t("home.folderPicker.addSource")}
          onSelect={(value) => (selection.result = value)}
        />
      ),
      {
        onClose: () => {
          mergeSources(selection.result)
          openDialog()
        },
      },
    )
  }

  async function create(input: ProjectCreateInput) {
    const project = await settingsApi<ProjectRecord>(sdk.url, platform.fetch ?? fetch, "/global/project", {
      method: "POST",
      body: JSON.stringify(input),
    })
    setDraft({ name: "", sources: [] })
    onCreated(project)
  }

  function createDialog(): JSX.Element {
    return (
      <DialogCreateProject
        name={draft.name}
        sources={draft.sources}
        onDraft={(name) => setDraft("name", name)}
        onChooseSources={() => void chooseSources()}
        onRemoveSource={(path) => setDraft("sources", (current) => current.filter((source) => source !== path))}
        onCreate={create}
      />
    )
  }

  function openDialog() {
    dialog.show(createDialog)
  }

  function show() {
    setDraft({ name: "", sources: [] })
    openDialog()
  }

  return { show }
}
