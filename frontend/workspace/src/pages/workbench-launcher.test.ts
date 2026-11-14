import { describe, expect, test } from "bun:test"
import type { Session } from "@axiomics/sdk/v2/client"
import type { ProjectRecord } from "./home-projects"
import { launchProject, selectLaunch } from "./workbench-launcher"

const project = (id: string, time: ProjectRecord["time"], extra: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id,
  worktree: `/labs/${id}`,
  origin: "axiomics",
  time,
  ...extra,
})

const conversation = (id: string, time: Partial<Session["time"]> = {}, extra: Partial<Session> = {}): Session => ({
  id,
  slug: id,
  projectID: "prj_alpha",
  directory: "/labs/prj_alpha",
  title: id,
  version: "2.0.0",
  time: { created: 0, updated: 0, ...time },
  ...extra,
})

const launch = (input: {
  projects: readonly ProjectRecord[]
  hidden?: ReadonlySet<string>
  sessions?: Readonly<Record<string, readonly Session[]>>
}) =>
  selectLaunch({
    projects: input.projects,
    hidden: input.hidden ?? new Set<string>(),
    sessions: input.sessions ?? {},
  })

const expectEmpty = (result: ReturnType<typeof selectLaunch>) => {
  expect(result).toEqual({ kind: "empty" })
}

describe("workbench launcher project choice", () => {
  test("returns empty when the catalog offers no launchable project", () => {
    expectEmpty(launch({ projects: [] }))
    expectEmpty(
      launch({
        projects: [
          // Resolved directories enter the catalog without the project origin.
          { id: "prj_directory", worktree: "/labs/arbitrary", time: { created: 90 } },
          { id: "", worktree: "/labs/anonymous", origin: "axiomics", time: { created: 80 } },
          { id: "prj_no_worktree", worktree: "", origin: "axiomics", time: { created: 70 } },
        ],
        // Even a session for the ineligible record cannot make it launchable.
        sessions: { prj_directory: [conversation("ses_orphan", { updated: 500 })] },
      }),
    )
  })

  test("never launches an archived project, even when it is the most recently active", () => {
    expectEmpty(launch({ projects: [project("prj_archived", { created: 100, activity: 500, archived: 501 })] }))

    const active = project("prj_active", { created: 10, activity: 20 })
    const archived = project("prj_archived", { created: 100, activity: 900, archived: 901 })
    expect(launch({ projects: [archived, active] })).toEqual({ kind: "new-session", project: active })

    // `archived: 0` is a restore marker, not an archive.
    const restored = project("prj_restored", { created: 30, activity: 40, archived: 0 })
    expect(launch({ projects: [restored] })).toEqual({ kind: "new-session", project: restored })
  })

  test("skips projects hidden by opaque ID or by a legacy worktree path", () => {
    const newest = project("prj_newest", { created: 100, activity: 100 })
    const older = project("prj_older", { created: 10, activity: 10 })

    for (const hidden of [["prj_newest"], ["/labs/prj_newest"]]) {
      expect(launch({ projects: [newest, older], hidden: new Set(hidden) })).toEqual({
        kind: "new-session",
        project: older,
      })
    }

    expectEmpty(launch({ projects: [newest, older], hidden: new Set(["prj_newest", "/labs/prj_older"]) }))
  })

  test("ranks by substantive activity, not by metadata updated", () => {
    const idle = project("prj_idle", { created: 10, updated: 9999 })
    const active = project("prj_active", { created: 20, updated: 30, activity: 200 })
    const created = project("prj_created", { created: 100, updated: 100 })

    expect(launch({ projects: [idle, active, created] })).toEqual({ kind: "new-session", project: active })
    expect(launch({ projects: [created, idle, active] })).toEqual({ kind: "new-session", project: active })
  })

  test("keeps creation time as the fallback and does not let a zero activity bury a project", () => {
    // max(activity, created), matching the list's updatedAt. The older
    // `activity ?? created` stamp would rank prj_zero at 0 and launch prj_created.
    const zero = project("prj_zero", { created: 100, activity: 0 })
    const created = project("prj_created", { created: 50 })
    expect(launch({ projects: [created, zero] })).toEqual({ kind: "new-session", project: zero })

    // A lagging activity stamp never demotes a project below an older one.
    const lagging = project("prj_lagging", { created: 300, activity: 40 })
    const other = project("prj_other", { created: 100, activity: 200 })
    expect(launch({ projects: [other, lagging] })).toEqual({ kind: "new-session", project: lagging })
  })

  test("breaks equal recency ties by ID, not by the list's name ordering or input order", () => {
    // prepareProjects would put "Alpha study" (prj_zeta) first by name; the
    // launcher must not take the list's first row, and must not depend on the
    // order the catalog arrived in.
    const zeta = project("prj_zeta", { created: 40, activity: 100 }, { name: "Alpha study" })
    const alpha = project("prj_alpha", { created: 50, activity: 100 }, { name: "Zeta study" })

    for (const projects of [
      [zeta, alpha],
      [alpha, zeta],
    ]) {
      expect(launch({ projects })).toEqual({ kind: "new-session", project: alpha })
    }
  })

  test("merges duplicate IDs before ranking, independent of input order", () => {
    const stale = project("prj_study", { created: 10, updated: 20, activity: 30 })
    const fresher = project("prj_study", { created: 10, updated: 20, activity: 100 })
    const other = project("prj_other", { created: 60, activity: 60 })

    for (const projects of [
      [stale, fresher, other],
      [other, fresher, stale],
      [fresher, other, stale],
    ]) {
      const result = launch({ projects })
      if (result.kind !== "new-session") throw new Error(`expected new-session, got ${result.kind}`)
      expect(result.project.id).toBe("prj_study")
      expect(result.project.time.activity).toBe(100)
    }
  })

  test("archives a deduplicated ID when its latest metadata record is archived", () => {
    const active = project("prj_study", { created: 10, updated: 20 })
    const archived = project("prj_study", { created: 10, updated: 30, archived: 31 })
    const fallback = project("prj_other", { created: 5 })

    for (const projects of [
      [active, archived, fallback],
      [archived, active, fallback],
      [fallback, active, archived],
    ]) {
      expect(launch({ projects })).toEqual({ kind: "new-session", project: fallback })
    }

    // The newest record wins, so a later restore of the same ID un-archives it.
    const restored = project("prj_study", { created: 10, updated: 40 })
    for (const projects of [
      [archived, restored, fallback],
      [restored, archived, fallback],
    ]) {
      expect(launch({ projects })).toEqual({ kind: "new-session", project: restored })
    }
  })
})

describe("workbench launcher session choice", () => {
  test("opens the bare project route when the chosen project has no known session", () => {
    const alpha = project("prj_alpha", { created: 10, activity: 10 })

    expect(launch({ projects: [alpha], sessions: {} })).toEqual({ kind: "new-session", project: alpha })
    expect(launch({ projects: [alpha], sessions: { prj_alpha: [] } })).toEqual({
      kind: "new-session",
      project: alpha,
    })
  })

  test("resumes the most recently updated root conversation of the chosen project", () => {
    const alpha = project("prj_alpha", { created: 10, activity: 10 })
    const child = conversation("ses_child", { updated: 90 }, { parentID: "ses_root" })
    const archived = conversation("ses_archived", { updated: 80, archived: 81 })
    const older = conversation("ses_older", { created: 5, updated: 20 })
    const recent = conversation("ses_recent", { created: 6, updated: 70 })

    const result = launch({ projects: [alpha], sessions: { prj_alpha: [child, archived, older, recent] } })
    if (result.kind !== "session") throw new Error(`expected a session launch, got ${result.kind}`)
    expect(result.project).toEqual(alpha)
    expect(result.session).toBe(recent)
  })

  test("does not resume archived or subagent-only conversations", () => {
    const alpha = project("prj_alpha", { created: 10, activity: 10 })
    const sessions = {
      prj_alpha: [
        conversation("ses_archived", { updated: 90, archived: 91 }),
        conversation("ses_child", { updated: 80 }, { parentID: "ses_archived" }),
      ],
    }

    expect(launch({ projects: [alpha], sessions })).toEqual({ kind: "new-session", project: alpha })
  })

  test("breaks session timestamp ties by the greater ID, matching the project route", () => {
    const alpha = project("prj_alpha", { created: 10, activity: 10 })
    const a = conversation("ses_a", { created: 7, updated: 50 })
    const b = conversation("ses_b", { created: 7, updated: 50 })

    for (const list of [
      [a, b],
      [b, a],
    ]) {
      const result = launch({ projects: [alpha], sessions: { prj_alpha: list } })
      if (result.kind !== "session") throw new Error(`expected a session launch, got ${result.kind}`)
      expect(result.session.id).toBe("ses_b")
    }
  })

  test("falls back to creation time when a legacy session has no updated stamp", () => {
    const alpha = project("prj_alpha", { created: 10, activity: 10 })
    // Truncated or legacy payloads can omit `time.updated` even though the SDK
    // type requires it; the project route tolerates that, so the launcher must too.
    const legacy = { id: "ses_legacy", time: { created: 60 } } as unknown as Session
    const empty = { id: "ses_empty", time: {} } as unknown as Session
    const recent = conversation("ses_recent", { created: 10, updated: 30 })

    const result = launch({ projects: [alpha], sessions: { prj_alpha: [empty, recent, legacy] } })
    if (result.kind !== "session") throw new Error(`expected a session launch, got ${result.kind}`)
    expect(result.session.id).toBe("ses_legacy")
  })

  test("reads only the chosen project's session window", () => {
    const alpha = project("prj_alpha", { created: 100, activity: 100 })
    const beta = project("prj_beta", { created: 10, activity: 10 })
    // A project missing from the record has no known session: Home must not
    // bootstrap another project just to discover a more recent conversation.
    expect(launch({ projects: [beta, alpha], sessions: { prj_beta: [conversation("ses_beta", { updated: 999 })] } })).toEqual(
      { kind: "new-session", project: alpha },
    )
  })

  test("leaves the caller's catalog and session records untouched", () => {
    const zeta = project("prj_zeta", { created: 10 })
    const alpha = project("prj_alpha", { created: 10 })
    const projects = [zeta, alpha]
    const sessions = { prj_alpha: [conversation("ses_alpha", { updated: 1 })] }

    launch({ projects, sessions })

    expect(projects).toEqual([zeta, alpha])
    expect(sessions).toEqual({ prj_alpha: [conversation("ses_alpha", { updated: 1 })] })
  })

  test("returns a catalog record rather than a prepared list row", () => {
    const alpha = { ...project("prj_alpha", { created: 10, updated: 11 }), sandboxes: ["/labs/prj_alpha/sandbox"] }
    const result = launch({ projects: [alpha], sessions: {} })
    if (result.kind !== "new-session") throw new Error(`expected new-session, got ${result.kind}`)

    expect(result.project).toEqual(alpha)
    expect("pinned" in result.project).toBe(false)
    expect("updatedAt" in result.project).toBe(false)
  })

  test("exposes the project decision so a prefetch can warm the same project", () => {
    const zeta = project("prj_zeta", { created: 10, activity: 90 })
    const alpha = project("prj_alpha", { created: 5, activity: 90 })
    const hidden = new Set(["prj_hidden"])

    const chosen = launchProject({ projects: [zeta, alpha], hidden })
    const result = launch({ projects: [zeta, alpha], hidden, sessions: {} })

    if (!chosen) throw new Error("expected a launchable project")
    expect(chosen.id).toBe("prj_alpha")
    if (result.kind === "empty") throw new Error("expected a launch target")
    expect(result.project.id).toBe(chosen.id)
  })
})
