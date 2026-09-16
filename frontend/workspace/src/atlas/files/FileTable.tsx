import { For, Show, createMemo, type JSX } from "solid-js"
import { FileIcon } from "@axiomics/ui/file-icon"
import { IconArrowUp, IconEdit, IconTrash } from "@/atlas/shared/Icon"
import { bytes } from "./bytes"

export interface FileRow {
  name: string
  type: "file" | "directory"
  size?: number
  ignored?: boolean
  /** Canonical location returned by the local file API. */
  absolute?: string
  /**
   * The server's own handle for the row (File.list, backend/cli/src/file/index.ts:522):
   * relative to the listing root when the folder sits inside it, absolute when
   * it does not. The table never shows it — opening a row does.
   */
  path?: string
}

export function FileTable(props: {
  rows: FileRow[]
  depth: number
  onOpen: (row: FileRow) => void
  onUp: () => void
  /** The visible rows are a search result, not the folder's full contents. */
  filtered?: boolean
  /** Suppresses a false empty state while the first listing is in flight. */
  loading?: boolean
  /** Suppresses a false empty state when the listing could not be read. */
  unavailable?: boolean
  /** Local write-capable sources expose lightweight row actions. */
  mutable?: boolean
  onRename?: (row: FileRow) => void
  onTrash?: (row: FileRow) => void
  copy?: {
    name: string
    size: string
    parent: string
    parentAria: string
    noMatches: string
    empty: string
    noMatchesDetail: string
    emptyDetail: string
    openFolder: (name: string) => string
    openFile: (name: string) => string
    ignored: (name: string) => string
    rename: string
    renameAria: (name: string) => string
    trash: string
    trashAria: (name: string) => string
  }
  /**
   * A listing is in flight. The rows on screen still describe the folder being
   * left, so they are shown but not clickable: clicking one would append its
   * name to the path the previous click already set, asking the server for a
   * folder inside a folder that was never opened.
   */
  busy?: boolean
}): JSX.Element {
  const sorted = createMemo(() =>
    [...props.rows].sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1,
    ),
  )

  return (
    <div class="files-table" classList={{ "files-table--busy": props.busy }} aria-busy={props.busy}>
      <Show when={sorted().length > 0}>
        <div class="files-table__header" aria-hidden="true">
          <span />
          <span>{props.copy?.name ?? "Name"}</span>
          <span>{props.copy?.size ?? "Size"}</span>
        </div>
      </Show>

      <Show when={props.depth > 0}>
        <button
          type="button"
          class="files-row files-row--up"
          data-file-up
          aria-label={props.copy?.parentAria ?? "Go to parent folder"}
          disabled={props.busy}
          onClick={() => props.onUp()}
        >
          <span class="files-row__glyph" aria-hidden="true">
            <IconArrowUp size={14} strokeWidth={1.5} />
          </span>
          <span class="files-row__name">{props.copy?.parent ?? "Parent folder"}</span>
          <span class="files-row__size" />
        </button>
      </Show>

      <Show
        when={sorted().length > 0}
        fallback={
          <Show when={!props.loading && !props.unavailable}>
            <div class="files-empty files-empty--folder" data-folder-empty>
              <strong>
                {props.filtered
                  ? (props.copy?.noMatches ?? "No matching files")
                  : (props.copy?.empty ?? "This folder is empty")}
              </strong>
              <span>
                {props.filtered
                  ? (props.copy?.noMatchesDetail ?? "Try a different name or clear the search.")
                  : (props.copy?.emptyDetail ?? "This location contains no files.")}
              </span>
            </div>
          </Show>
        }
      >
        <For each={sorted()}>
          {(row) => (
            <div
              class="files-row files-row--entry"
              classList={{ "files-row--ignored": row.ignored, "files-row--mutable": props.mutable }}
              data-file-entry={row.name}
            >
              <button
                type="button"
                class="files-row__open"
                data-file-row={row.name}
                data-file-kind={row.type}
                aria-label={
                  row.type === "directory"
                    ? (props.copy?.openFolder(row.name) ?? `Open folder ${row.name}`)
                    : (props.copy?.openFile(row.name) ?? `Open file ${row.name}`)
                }
                title={
                  row.ignored ? (props.copy?.ignored(row.name) ?? `${row.name} is ignored by the project`) : row.name
                }
                disabled={props.busy}
                onClick={() => props.onOpen(row)}
              >
                <span class="files-row__glyph" aria-hidden="true">
                  <FileIcon node={{ path: row.name, type: row.type }} class="files-row__type-glyph" />
                </span>
                <span class="files-row__name" data-file-name>
                  {row.name}
                </span>
                <span class="files-row__size" data-file-size>
                  {row.type === "directory" ? "" : bytes(row.size)}
                </span>
              </button>
              <Show when={props.mutable}>
                <span class="files-row__actions">
                  <button
                    type="button"
                    data-file-rename={row.name}
                    aria-label={props.copy?.renameAria(row.name) ?? `Rename ${row.name}`}
                    title={props.copy?.rename ?? "Rename"}
                    disabled={props.busy}
                    onClick={() => props.onRename?.(row)}
                  >
                    <IconEdit size={13} strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    class="files-row__trash"
                    data-file-trash={row.name}
                    aria-label={props.copy?.trashAria(row.name) ?? `Move ${row.name} to Trash`}
                    title={props.copy?.trash ?? "Move to Trash"}
                    disabled={props.busy}
                    onClick={() => props.onTrash?.(row)}
                  >
                    <IconTrash size={13} strokeWidth={1.5} />
                  </button>
                </span>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
