# Recorded cases

The curated gallery is deployment-wide. `catalog.ts` contains approved case
copy, public figure assets, and stable project/session replay routes. The source
sessions and Results remain in their own projects. Private session history is
still scoped to the active project; publishing a card does not copy its history.

`session-shell.tsx` remounts the Session page for the exact `replay=1` query
parameter. The Session page keeps its project navigation, session list,
conversation surface and Results pane, then replaces the normal tabs and prompt
with the replay header and player. The viewer is keyed by project scope and
session ID, aborts requests on disposal, and owns its playback timer. Leaving
replay removes the query parameter.

Replay loads the existing session/messages endpoint without a limit. The result
is a stable snapshot, independent of live synchronization, pagination and SSE.
`timeline.ts` is the only definition of replay frames. Each tool call occupies
one frame containing its saved input and result, rendered by the original tool
component. Replay does not reconstruct intermediate streaming states or their
timing. Future user messages, provider errors and turn summaries are exposed
only when their frames are reached.

The visible transcript follows the historical session renderer. At cursor `n`,
it is the same session presentation for the recorded prefix through frame `n`;
at the final cursor it has the same turns, compaction boundaries, tool cards,
Results and final answers as opening that historical session. Playback adds a
clock and disclosure state. It does not delete, rewrite, merge or reorder saved
messages and parts.

Playback opens paused on the first frame. Space and Enter toggle playback;
ArrowLeft and ArrowRight pause and move one frame. These shortcuts are scoped to
the replay surface and do not capture keystrokes from interactive controls or
open dialogs. Automatic scrolling follows playback until the reader scrolls
away; `Current frame` resumes following.

Each projected view is cloned before Solid reconciles it, so seeking cannot
mutate the recording. A nested DataProvider exposes no permission, question or
save callbacks. The original SessionTurn, tool registry and artifact renderers
consume this view. The player supplies the shared UI's generic disclosure
contract: the current reasoning or tool card opens at each cursor revision,
the previous card folds, and a reader can override either state until the next
frame. The contract carries presentation state only and does not couple shared
components to replay data or playback controls.

Completed Result saves stay in the chronological activity stream while steps
are expanded, so their original `SavedArtifactTool` card and preview participate
in replay disclosure. When steps are collapsed, SessionTurn replaces those tool
rows with its compact `Generated` strip; the same view never renders both.

The complete recording and visible projection live in memory. Very large
recordings may eventually need a dedicated snapshot/paging API; do not reuse
the live transcript's partial cache as if it were a complete recording.

Validation:

- From `frontend/workspace`: `bun test src/pages/cases src/utils/axiomics-fetch.test.ts`
- Existing shared UI regression: from `frontend/ui`, `bun test src/components/session-turn-trajectory.test.ts`
