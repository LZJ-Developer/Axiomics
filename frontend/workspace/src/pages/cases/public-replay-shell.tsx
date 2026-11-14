import { SessionRenderProviders } from "@/pages/session-render-providers"
import PublicReplay from "./public-replay"

/** Lazy boundary for the public workspace: markdown, diffs, code highlighting
 * and the science tool renderers load only after a visitor opens a case or
 * starts a conversation. */
export default function PublicReplayShell(props: { caseID?: string }) {
  return (
    <SessionRenderProviders>
      <PublicReplay caseID={props.caseID} />
    </SessionRenderProviders>
  )
}
