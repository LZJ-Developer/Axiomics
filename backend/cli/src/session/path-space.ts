import fs from "fs"
import os from "os"
import path from "path"
import { Instance } from "@/project/instance"
import { SessionFilesystem } from "@/session/filesystem"
import { Config } from "@/config/config"
import { Sandbox } from "@/sandbox/sandbox"
import { VIEW_HOME, VIEW_TMP, relocate as relocatePrefix } from "@/sandbox/view"
import { Log } from "@/util/log"

const log = Log.create({ service: "path-space" })

/**
 * The model's view of its own machine.
 *
 * The harness runs on a host whose real paths are long, UUID-shaped, and say
 * nothing about the research task. A model that sees them learns host layout
 * instead of the workspace contract, and repeats those paths back to people.
 * This module names the roots the model may work in and maps between that
 * vocabulary and the host:
 *
 *   /home/example-user-d4f0bc/project  →  the project's durable files (the git worktree
 *                           when the project is opened inside one)
 *   /home/example-user-d4f0bc/scratch  →  this conversation's scratch root
 *
 * The mapping is a boundary, not a rename: permissions, provenance, artifact
 * storage, and the human-facing approval UI keep using host paths. Only text
 * that reaches the model is translated.
 */
export namespace PathSpace {
  export const home = VIEW_HOME
  export const project = `${home}/project`
  export const scratch = `${home}/scratch`

  export type Root = { host: string; model: string }
  /** A folder connected to the project by the user. Read grants must stay
   * read-only in the mount, so access travels with the root. */
  export type Connected = Root & { access: "read" | "write" }
  export type Roots = {
    project: Root
    scratch: Root
    /** The repository above the opened directory. Present only when the
     * project directory is a strict descendant: the mount must cover the
     * worktree so git and build tools work, while the model is told it is
     * working in the subdirectory it actually opened. */
    repository?: Root
    connected?: Connected[]
    /** Home-prefix relocation applied to policy mounts. Text that names a
     * path under the host home is rewritten with the same rule. */
    relocate?: { from: string; to: string }
  }

  /** Start a translation with the cheapest possible answer: text that cannot
   * name a root is returned untouched without touching storage. */
  export function mentions(value: string) {
    return value === home || value.startsWith(home + "/")
  }

  /** Rewrite each colon-separated segment of a path list from the host home to
   * the synthetic one. Segments match exactly so `/home/example-user-27d0d0` is untouched.
   * Existing segments resolve through symlinks first: the policy mounted their
   * canonical location, and programs that derive an install prefix from their
   * own path (Python, R) must be given that same spelling. */
  export function remapHome(relocate: { from: string; to: string } | undefined, value: string) {
    if (!relocate) return value
    return value.split(":").map(remapSegment.bind(undefined, relocate)).join(":")
  }

  function remapSegment(relocate: { from: string; to: string } | undefined, segment: string) {
    if (!relocate) return segment
    let resolved = segment
    try {
      resolved = fs.realpathSync.native(segment)
    } catch {}
    const canonical = relocatePrefix(relocate, resolved)
    if (canonical !== resolved) return canonical
    return relocatePrefix(relocate, segment)
  }

  /** Translate one environment value into the view's vocabulary. Workspace
   * roots are named by their model spelling; anything else under the host home
   * follows the same prefix relocation as the mounts. Colon-separated path
   * lists are handled segment by segment so a token or flag keeps its bytes. */
  export function translateValue(
    current: Roots,
    relocate: { from: string; to: string } | undefined,
    value: string,
  ) {
    return value
      .split(":")
      .map((segment) => {
        const rooted = toModel(current, segment)
        return rooted !== segment ? rooted : remapSegment(relocate, segment)
      })
      .join(":")
  }

  /** The complete environment of the sandboxed payload. Everything the spawn
   * carries is translated, so the payload never inherits a host path or host
   * identity; bubblewrap applies the result with `--setenv` and drops every
   * inherited variable this map does not name. */
  export function payloadEnv(view: SandboxView, base: Record<string, string | undefined>) {
    const output: Record<string, string> = {}
    for (const [key, value] of Object.entries(base)) {
      if (typeof value === "string") output[key] = translateValue(view.roots, view.relocate, value)
    }
    output.HOME = view.home
    // Explicit view entries (USER, LOGNAME, a private data root) describe the
    // synthetic machine and win over anything the host supplied.
    return { ...output, ...view.env }
  }

  /** Translate the declared path fields of a tool call from the model's
   * vocabulary to host spellings. The session boundary calls this once for
   * every tool, so an individual tool cannot forget to. */
  export async function localizeArgs(sessionID: string, fields: readonly string[], args: unknown) {
    if (!args || typeof args !== "object") return args
    const input = args as Record<string, unknown>
    const output = { ...input }
    for (const field of fields) {
      const value = output[field]
      if (typeof value === "string") output[field] = await toHost(sessionID, value)
    }
    return output
  }

  /** Whether this host can actually present the view. The model vocabulary is
   * only truthful while bubblewrap assembles it and the deployment keeps the
   * sandbox enabled; everywhere else the host spelling stays authoritative. */
  export async function exposed() {
    if (process.platform !== "linux" || Sandbox.backend() !== "bubblewrap") return false
    const execution = await Config.getExecution().catch(() => undefined)
    return execution?.sandbox?.enabled !== false
  }

  function contains(root: string, value: string) {
    return value === root || value.startsWith(root + path.sep)
  }

  function relative(root: string, value: string) {
    return value === root ? "" : value.slice(root.length + 1).split(path.sep).join("/")
  }

  function join(root: string, value: string) {
    return value ? `${root}/${value}` : root
  }

  /** Stable model names for user-connected folders: the basename, with a
   * numeric suffix on collisions. Only explicit grants qualify; workspace and
   * tool-output grants are already represented by the project/scratch roots. */
  export function connectedRoots(
    grants: readonly {
      path: string
      access: "read" | "write"
      source: string
      time: { consumed?: number; revoked?: number }
    }[],
  ): Connected[] {
    const used = new Map<string, number>()
    const result: Connected[] = []
    for (const grant of grants) {
      if (grant.time.consumed || grant.time.revoked) continue
      if (grant.source !== "api" && grant.source !== "permission") continue
      const base = path.basename(grant.path) || "folder"
      const count = (used.get(base) ?? 0) + 1
      used.set(base, count)
      result.push({
        host: grant.path,
        model: `${home}/connected/${count === 1 ? base : `${base}-${count}`}`,
        access: grant.access,
      })
    }
    return result
  }

  export async function roots(sessionID: string): Promise<Roots> {
    const directory = Instance.directory
    const worktree = Instance.worktree
    const scratchHost = sessionID.startsWith("ses_")
      ? await SessionFilesystem.workspace(sessionID)
      : directory
    if (!(await exposed())) {
      return {
        project: { host: directory, model: directory },
        scratch: { host: scratchHost, model: scratchHost },
      }
    }
    // A project opened inside a repository has two roots: the directory the
    // user chose and the worktree that git needs. The mount covers the
    // worktree; the model's project path is the subdirectory it opened.
    const hostHome = os.homedir()
    const relocate =
      hostHome !== "/" && hostHome !== home && hostHome.length > 1 ? { from: hostHome, to: home } : undefined
    const repository = contains(worktree, directory) && worktree !== directory ? worktree : undefined
    const projectModel = repository ? join(project, relative(repository, directory)) : project
    // Connected folders get stable names under the synthetic home so the
    // model never has to learn a host path to reach them.
    const connected = sessionID.startsWith("ses_")
      ? connectedRoots((await SessionFilesystem.state(sessionID).catch(() => undefined))?.grants ?? [])
      : []
    return {
      project: { host: directory, model: projectModel },
      // Legacy sessions keep scratch inside the project directory. One host
      // directory must not appear under two names, so it reports the project
      // spelling rather than inventing a second mount.
      scratch: {
        host: scratchHost,
        model: contains(directory, scratchHost) ? join(projectModel, relative(directory, scratchHost)) : scratch,
      },
      ...(repository ? { repository: { host: repository, model: project } } : {}),
      ...(connected.length ? { connected } : {}),
      ...(relocate ? { relocate } : {}),
    }
  }

  function all(current: Roots) {
    return [
      current.project,
      current.scratch,
      ...(current.repository ? [current.repository] : []),
      ...(current.connected ?? []),
    ]
  }

  /** Host paths that the view replaces; callers must keep them out of the
   * sandbox policy so the same directory cannot appear under two names. */
  export function hostRoots(current: Roots) {
    return [
      current.project.host,
      current.scratch.host,
      ...(current.repository ? [current.repository.host] : []),
      ...(current.connected ?? []).map((root) => root.host),
    ]
  }

  /** Translate a model-supplied path to the host. Unknown model paths pass
   * through unchanged so the caller fails with an error that still names the
   * path the model used. */
  export async function toHost(sessionID: string, value: string) {
    if (!mentions(value)) return value
    const current = await roots(sessionID)
    const ordered = all(current).sort((left, right) => right.model.length - left.model.length)
    for (const root of ordered) {
      if (value === root.model) return root.host
      if (value.startsWith(root.model + "/")) return path.join(root.host, relative(root.model, value))
    }
    return value
  }

  /** Translate a host path back to the model's vocabulary. Longest host root
   * wins so a scratch directory nested inside a project still reports as
   * scratch. */
  export function toModel(current: Roots, value: string) {
    const ordered = all(current).sort((left, right) => right.host.length - left.host.length)
    for (const root of ordered) {
      if (value === root.host) return root.model
      if (value.startsWith(root.host + path.sep)) {
        return join(root.model, value.slice(root.host.length + 1).split(path.sep).join("/"))
      }
    }
    return value
  }

  /** Replace every host root spelling inside free text (tool output, errors)
   * with the model's spelling. Longest host root first so a scratch directory
   * nested inside a project is not first rewritten as a project path. */
  export function rewriteText(current: Roots, text: string) {
    const pairs = [
      ...all(current).map((root) => ({ from: root.host, to: root.model })),
      ...(current.relocate ? [{ from: current.relocate.from, to: current.relocate.to }] : []),
    ].sort((left, right) => right.from.length - left.from.length)
    let output = text
    for (const pair of pairs) {
      if (pair.from === pair.to) continue
      output = output.split(pair.from).join(pair.to)
    }
    return output
  }

  /** The roots that may be mounted behind the synthetic home for a command
   * whose working directory is `cwd`. Returns undefined when the command works
   * outside every root, where a virtual spelling would be a lie. */
  export async function view(sessionID: string, cwd: string): Promise<SandboxView | undefined> {
    if (!(await exposed())) return
    const current = await roots(sessionID)
    const target = all(current)
      .filter((root) => contains(root.host, cwd))
      .sort((left, right) => right.host.length - left.host.length)[0]
    if (!target) {
      log.debug("view unavailable: cwd outside workspace roots", { cwd, roots: all(current) })
      return
    }
    const mountRoot = current.repository ?? current.project
    const mounts = [{ source: mountRoot.host, destination: mountRoot.model }]
    if (current.scratch.host !== mountRoot.host && !contains(mountRoot.host, current.scratch.host)) {
      mounts.push({ source: current.scratch.host, destination: current.scratch.model })
    }
    const readOnlyMounts = (current.connected ?? [])
      .filter((root) => root.access !== "write")
      .map((root) => ({ source: root.host, destination: root.model }))
    for (const root of current.connected ?? []) {
      if (root.access === "write") mounts.push({ source: root.host, destination: root.model })
    }
    const targetCwd = join(target.model, relative(target.host, cwd))
    log.debug("view active", { cwd: targetCwd, mounts, relocate: current.relocate })
    return {
      home,
      cwd: targetCwd,
      mounts,
      ...(readOnlyMounts.length ? { readOnlyMounts } : {}),
      relocate: current.relocate,
      env: { USER: "agent", LOGNAME: "agent" },
      roots: current,
    }
  }

  /** The sandbox view plus the roots it was derived from: the sandbox module
   * never depends on session storage, so callers carry the roots alongside. */
  export type SandboxView = Sandbox.View & { roots: Roots }
}
