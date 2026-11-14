import { Show, type JSX } from "solid-js"

/**
 * The frame every Axiomics conversation composer shares: the form, the editor
 * area and the footer row.
 *
 * The public entry slots a plain textarea and the same controls, whose actions
 * ask for an account before they run. The workspace can pass its whole tree as
 * children (its editor and footer already exist) or use the structured slots;
 * either way both surfaces share the form, the geometry and the class contract,
 * which is what makes the anonymous page read as the same product.
 */
export function ComposerShell(props: {
  class?: string
  dragging?: boolean
  onSubmit?: (event: SubmitEvent) => void
  /** Chips, attachments and other content above the editor. */
  before?: JSX.Element
  /** Structured mode: the shell owns the editor and footer wrappers. */
  editor?: JSX.Element
  footer?: JSX.Element
  /** Unstructured mode: the caller supplies the editor and footer markup. */
  children?: JSX.Element
}): JSX.Element {
  return (
    <form
      onSubmit={props.onSubmit}
      classList={{
        "group/prompt-input": true,
        "workspace-composer": true,
        "relative overflow-visible": true,
        "border-icon-info-active border-dashed": props.dragging,
        [props.class ?? ""]: !!props.class,
      }}
    >
      {props.before}
      <Show when={props.editor} fallback={props.children}>
        {(editor) => <div class="workspace-composer__editor">{editor()}</div>}
      </Show>
      <Show when={props.footer}>{(footer) => <div class="workspace-composer__footer">{footer()}</div>}</Show>
    </form>
  )
}
