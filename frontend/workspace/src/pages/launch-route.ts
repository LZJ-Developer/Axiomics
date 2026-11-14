import { projectHref } from "@/utils/project-route"
import type { Launch } from "./workbench-launcher"

/** What `/` renders while it decides, and whether it may enter a project. */
export type LaunchPhase = "loading" | "error" | "empty" | "launching"

/**
 * The launcher's gate, in one place so it cannot be re-derived incorrectly.
 *
 * `ready` alone is not a freshness guarantee: bootstrap sets it even when
 * `/global/health` fails and even when the project catalog refresh rejects, so
 * the store may still hold the persisted cache. Entering a project from that
 * cache can land on a worktree that is gone, and the project route then marks a
 * merely-offline project as hidden. A confirmed failure therefore wins over
 * readiness, and `healthy === undefined` (the checking state) is not a failure.
 *
 * "launching" is the only phase that may navigate; every other phase renders a
 * state and stays on `/`.
 */
export function launchPhase(input: { ready: boolean; healthy: boolean | undefined; target: Launch }): LaunchPhase {
  if (input.healthy === false) return "error"
  if (!input.ready) return "loading"
  if (input.target.kind === "empty") return "empty"
  return "launching"
}

/**
 * The route a launch enters, or `undefined` when there is nothing to enter.
 *
 * A `new-session` launch deliberately uses the bare `/<project>/session` route:
 * the project page owns session resolution there (it has the fuller window and
 * the remembered tab) and replaces itself with the conversation it picks. The
 * launcher must not manufacture a blank session by navigating to a made-up id.
 */
export function launchHref(target: Launch): string | undefined {
  if (target.kind === "empty") return
  if (target.kind === "session") return projectHref(target.project, target.project.worktree, target.session.id)
  return projectHref(target.project)
}
