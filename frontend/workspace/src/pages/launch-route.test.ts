import { describe, expect, test } from "bun:test"
import type { Session } from "@axiomics/sdk/v2/client"
import type { ProjectRecord } from "./home-projects"
import { launchHref, launchPhase } from "./launch-route"
import type { Launch } from "./workbench-launcher"

type FixtureProject = ProjectRecord & { sandboxes?: string[] }

const project = (id: string, extra: Partial<FixtureProject> = {}): FixtureProject => ({
  id,
  worktree: `/labs/${id}`,
  origin: "axiomics",
  time: { created: 10, activity: 20 },
  ...extra,
})

const session = (id: string): Session => ({ id }) as Session

const empty: Launch = { kind: "empty" }
const fresh: Launch = { kind: "new-session", project: project("prj_alpha") }
const resume: Launch = { kind: "session", project: project("prj_alpha"), session: session("ses_alpha") }

describe("workbench launch gate", () => {
  test("never enters a project before the catalog is ready", () => {
    for (const healthy of [true, false, undefined]) {
      expect(launchPhase({ ready: false, healthy, target: resume })).toBe(healthy === false ? "error" : "loading")
      expect(launchPhase({ ready: false, healthy, target: fresh })).toBe(healthy === false ? "error" : "loading")
    }
  })

  test("treats a confirmed outage as an error even after ready", () => {
    expect(launchPhase({ ready: true, healthy: false, target: resume })).toBe("error")
    expect(launchPhase({ ready: true, healthy: false, target: empty })).toBe("error")
    expect(launchPhase({ ready: false, healthy: false, target: empty })).toBe("error")
  })

  test("does not read the checking health state as a failure", () => {
    expect(launchPhase({ ready: true, healthy: undefined, target: resume })).toBe("launching")
    expect(launchPhase({ ready: true, healthy: true, target: resume })).toBe("launching")
  })

  test("stays on the launcher when the catalog has nothing to open", () => {
    expect(launchPhase({ ready: true, healthy: true, target: empty })).toBe("empty")
    expect(launchPhase({ ready: true, healthy: undefined, target: empty })).toBe("empty")
  })

  test("is the only phase that navigates", () => {
    for (const ready of [true, false])
      for (const healthy of [true, false, undefined])
        for (const target of [empty, fresh, resume]) {
          const phase = launchPhase({ ready, healthy, target })
          const enterable = ready && healthy !== false && target.kind !== "empty"
          expect(phase === "launching").toBe(enterable)
          expect(launchHref(target) !== undefined).toBe(target.kind !== "empty")
        }
  })
})

describe("workbench launch route", () => {
  test("resumes the chosen conversation on the canonical project route", () => {
    expect(launchHref(resume)).toBe("/prj_alpha/session/ses_alpha")
  })

  test("keeps a session-less launch on the bare route the project page resolves", () => {
    expect(launchHref(fresh)).toBe("/prj_alpha/session")
    expect(launchHref(empty)).toBeUndefined()
  })

  test("encodes the session id instead of splitting the path", () => {
    const strange = { kind: "session", project: project("prj_alpha"), session: session("ses/../x y") } as Launch
    expect(launchHref(strange)).toBe("/prj_alpha/session/ses%2F..%2Fx%20y")
  })

  test("never builds a directory-keyed link, even for a project with sandboxes", () => {
    const sandboxed = project("prj_alpha", { sandboxes: ["/labs/prj_alpha/sandbox"] })
    expect(launchHref({ kind: "new-session", project: sandboxed })).toBe("/prj_alpha/session")
    expect(launchHref({ kind: "session", project: sandboxed, session: session("ses_alpha") })).toBe(
      "/prj_alpha/session/ses_alpha",
    )
  })
})

describe("workbench routing wiring", () => {
  const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text()

  test("routes /projects before the project catch-all", async () => {
    const app = await read("../app.tsx")
    expect(app).toContain('import Projects from "@/pages/projects"')
    expect(app.indexOf('path="/projects"')).toBeGreaterThan(0)
    expect(app.indexOf('path="/projects"')).toBeLessThan(app.indexOf('path="/:dir"'))
  })

  test("keeps the launcher from resurrecting hidden projects or creating one", async () => {
    const [home, projects] = await Promise.all([read("./home.tsx"), read("./projects.tsx")])

    // Launching is not a user opening a row: unhide/hide belong to the list and
    // to the availability surface, and creating belongs to the dialog.
    expect(home).not.toContain("projectPrefs.unhide")
    expect(home).not.toContain("projectPrefs.hide")
    expect(home).not.toContain("settingsApi")
    expect(home).toContain("{ replace: true }")
    expect(home).toContain("launchPhase({")
    expect(home).toContain("launchHref(")

    expect(projects).toContain("projectPrefs.unhide(project.id, project.worktree)")
    expect(projects).toContain("useProjectCreate(")
    expect(projects).toContain('navigate("/cases")')
    expect(projects).not.toContain("base64Encode")
  })
})
