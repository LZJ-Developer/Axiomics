import { SessionRenderProviders } from "@/pages/session-render-providers"
import PublicReplay from "./public-replay"

/** Lazy boundary for the public workspace: markdown, diffs, code highlighting
 * and the science tool renderers load only after a visitor opens a case or
 * starts a conversation.
 *
 * Both entries go through here — the anonymous shell and the `/cases/:caseID`
 * route inside the workbench. The player renders a compaction component that
 * resolves `DiffComponent` from context, so mounting `PublicReplay` bare (as
 * the workbench route once did) throws and replaces the whole app with the
 * recovery screen. Keeping the providers on this boundary is what makes the
 * two entries behave the same. */
export default function PublicReplayShell(props: { caseID?: string; embedded?: boolean }) {
  return (
    <SessionRenderProviders>
      <PublicReplay caseID={props.caseID} embedded={props.embedded} />
    </SessionRenderProviders>
  )
}
