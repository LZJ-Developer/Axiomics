import { Show, type JSX } from "solid-js"
import { IconCpu, IconFolder, IconTerminal } from "@/atlas/shared/Icon"
import { preloadTerminal } from "@/components/terminal"
import "./session-sidebar.css"

export type SessionContext = "files" | "terminal" | "canvas" | "kernels" | "trace" | "artifact"

export interface SidebarCopy {
  workspace: string
  files: string
  projectFiles: string
  openFiles: string
  terminal: string
  projectShell: string
  openTerminal: string
  compute: string
  computeDetail: string
  openCompute: string
}

const fallback: SidebarCopy = {
  workspace: "Workspace",
  files: "Files",
  projectFiles: "Project files",
  openFiles: "Open project files",
  terminal: "Terminal",
  projectShell: "Project shell",
  openTerminal: "Open project terminal",
  compute: "Compute",
  computeDetail: "Runtimes and jobs",
  openCompute: "Open project compute",
}

export function CompactContextActions(props: {
  context: SessionContext
  contextOpen: boolean
  onContext: (context: SessionContext) => void
  copy?: SidebarCopy
}): JSX.Element {
  const copy = () => props.copy ?? fallback
  return (
    <div class="workspace-header__context-actions" style={{ display: "contents" }}>
      <button
        type="button"
        role="menuitem"
        aria-pressed={props.context === "files" && props.contextOpen}
        onClick={() => props.onContext("files")}
      >
        <IconFolder size={16} strokeWidth={1.5} />
        {copy().files}
      </button>
      <button
        type="button"
        role="menuitem"
        aria-pressed={props.context === "terminal" && props.contextOpen}
        onPointerEnter={preloadTerminal}
        onFocus={preloadTerminal}
        onClick={() => props.onContext("terminal")}
      >
        <IconTerminal size={16} strokeWidth={1.5} />
        {copy().terminal}
      </button>
      <button
        type="button"
        role="menuitem"
        aria-pressed={props.context === "kernels" && props.contextOpen}
        onClick={() => props.onContext("kernels")}
      >
        <IconCpu size={16} strokeWidth={1.5} />
        {copy().compute}
      </button>
    </div>
  )
}

export function SidebarAction(props: {
  class?: string
  label: string
  detail: string
  ariaLabel: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onWarm?: () => void
  onClick: () => void
  children: JSX.Element
}): JSX.Element {
  return (
    <button
      type="button"
      class={`session-sidebar__action${props.class ? ` ${props.class}` : ""}`}
      aria-label={props.ariaLabel}
      data-tooltip={props.label}
      aria-pressed={props.active === undefined ? undefined : props.active}
      data-selected={props.active ? "true" : undefined}
      disabled={props.disabled}
      onPointerEnter={() => props.onWarm?.()}
      onFocus={() => props.onWarm?.()}
      onClick={() => props.onClick()}
    >
      <span class="session-sidebar__action-icon" aria-hidden="true">
        {props.children}
      </span>
      <span class="session-sidebar__action-copy">
        <strong>{props.label}</strong>
        <span>{props.detail}</span>
      </span>
      <Show when={props.shortcut}>
        <kbd aria-hidden="true">{props.shortcut}</kbd>
      </Show>
    </button>
  )
}

export function SessionSidebarActions(props: {
  context: SessionContext
  contextOpen: boolean
  onContext: (context: SessionContext) => void
  copy?: SidebarCopy
}): JSX.Element {
  const copy = () => props.copy ?? fallback
  return (
    <div class="session-sidebar__context-actions">
      <div class="session-sidebar__group-label" aria-hidden="true">
        {copy().workspace}
      </div>
      <div class="session-sidebar__action-list">
        <SidebarAction
          label={copy().files}
          detail={copy().projectFiles}
          ariaLabel={copy().openFiles}
          active={props.context === "files" && props.contextOpen}
          onClick={(_event?: Event) => props.onContext("files")}
        >
          <IconFolder size={16} strokeWidth={1.5} />
        </SidebarAction>
        <SidebarAction
          label={copy().terminal}
          detail={copy().projectShell}
          ariaLabel={copy().openTerminal}
          shortcut="⌃`"
          active={props.context === "terminal" && props.contextOpen}
          onWarm={preloadTerminal}
          onClick={(_event?: Event) => props.onContext("terminal")}
        >
          <IconTerminal size={16} strokeWidth={1.5} />
        </SidebarAction>
        <SidebarAction
          label={copy().compute}
          detail={copy().computeDetail}
          ariaLabel={copy().openCompute}
          active={props.context === "kernels" && props.contextOpen}
          onClick={(_event?: Event) => props.onContext("kernels")}
        >
          <IconCpu size={16} strokeWidth={1.5} />
        </SidebarAction>
      </div>
    </div>
  )
}
