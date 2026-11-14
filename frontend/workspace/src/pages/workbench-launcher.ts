import type { Session } from "@axiomics/sdk/v2/client"
import { prepareProjects, type PreparedProject, type ProjectRecord } from "./home-projects"
import { sessionEntryTarget } from "./session-entry"

/**
 * Where the authenticated workspace boot should land.
 *
 * `new-session` is a route, not a mutation: the caller navigates to the bare
 * `/<project>/session` path and the project route decides there, from its own
 * (fuller) session window, whether to resume or start a conversation. Home's
 * session data can be missing or trimmed, so `new-session` must never be read
 * as "create a session here".
 */
export type Launch =
  | { kind: "session"; project: ProjectRecord; session: Session }
  | { kind: "new-session"; project: ProjectRecord }
  | { kind: "empty" }

export type LaunchProjectInput = {
  /** `sync.data.project`: the server catalog, authoritative once ready. */
  projects: readonly ProjectRecord[]
  /** `projectPrefs.hidden()`, keyed by project ID and/or legacy worktree path. */
  hidden: ReadonlySet<string>
}

export type LaunchInput = LaunchProjectInput & {
  /** Session lists keyed by project ID; only the chosen project's list is read. */
  sessions: Readonly<Record<string, readonly Session[]>>
}

/**
 * Pick the project the workspace boot should open, or nothing when the catalog
 * offers no eligible project.
 *
 * Eligibility, deduplication and the recency stamp are shared with the project
 * list (`prepareProjects`), so the launcher cannot open a project the list
 * refuses to show and a launch agrees with the row the user sees. Ranking then
 * ignores the list's pinned-first order: pinning is a list affordance. Equal
 * stamps fall back to the ID, which makes the choice independent of the order
 * the catalog arrived in.
 *
 * The stamp is `max(activity, created)` — the list's `updatedAt` — never
 * `time.updated`, which older servers bumped for runtime initialization and
 * icon changes. `recentProject()` in global-sync uses `activity ?? created`
 * instead, which sinks a record whose activity is explicitly 0; real catalogs
 * agree on both, and this form keeps a launch and the warm prefetch pointed at
 * the same project (a mismatch costs a second instance bootstrap).
 */
export function launchProject(input: LaunchProjectInput): PreparedProject | undefined {
  return prepareProjects([...input.projects], input.hidden).sort(
    (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
  )[0]
}

/**
 * Decide where the workspace boot goes, with no side effects: it never creates
 * a project, never unhides or hides a preference, and never bootstraps a
 * directory. The caller performs `layout.projects.open`/`server.projects.touch`
 * and navigates with `replace: true`.
 *
 * The caller also gates the decision: skip it until `sync.ready`, and do not
 * navigate while `server.healthy() === false`. `ready` alone is not a
 * freshness guarantee (bootstrap sets it even when `/global/health` fails), and
 * opening an unreachable worktree makes the project route hide a project that
 * merely was offline.
 *
 * Session scope is the chosen project only. Home must not bootstrap other
 * projects to discover conversations (one server instance per project), and a
 * project absent from `sessions` simply has no known session here — still the
 * bare project route, which re-runs `sessionEntryTarget` on the real window.
 */
export function selectLaunch(input: LaunchInput): Launch {
  const project = launchProject(input)
  if (!project) return { kind: "empty" }

  // Delegating keeps the launcher and the project route from resuming
  // different conversations for the same project.
  const sessions = input.sessions[project.id] ?? []
  const target = sessionEntryTarget(sessions)
  const session = target === "new" ? undefined : sessions.find((candidate) => candidate.id === target)
  if (!session) return { kind: "new-session", project: catalogRecord(project) }
  return { kind: "session", project: catalogRecord(project), session }
}

/** `updatedAt` and `pinned` describe list rows, not catalog records. */
function catalogRecord({ updatedAt, pinned, ...project }: PreparedProject): ProjectRecord {
  return project
}
