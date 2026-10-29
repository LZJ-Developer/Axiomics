import { describe, expect, test } from "bun:test"
import { PathSpace } from "./path-space"

const roots = {
  project: { host: "/data/projects/p1", model: "/home/example-user-d4f0bc/project" },
  scratch: { host: "/data/workspaces/p1/s1", model: "/home/example-user-d4f0bc/scratch" },
}

describe("path space", () => {
  test("maps both roots and their descendants to the model vocabulary", () => {
    expect(PathSpace.toModel(roots, "/data/projects/p1")).toBe("/home/example-user-d4f0bc/project")
    expect(PathSpace.toModel(roots, "/data/projects/p1/results/a.csv")).toBe("/home/example-user-d4f0bc/project/results/a.csv")
    expect(PathSpace.toModel(roots, "/data/workspaces/p1/s1")).toBe("/home/example-user-d4f0bc/scratch")
    expect(PathSpace.toModel(roots, "/data/workspaces/p1/s1/run.py")).toBe("/home/example-user-d4f0bc/scratch/run.py")
    expect(PathSpace.toModel(roots, "/usr/bin/env")).toBe("/usr/bin/env")
  })

  test("prefers the longest host root when scratch sits inside the project", () => {
    const nested = {
      project: { host: "/data/projects/p1", model: "/home/example-user-d4f0bc/project" },
      scratch: { host: "/data/projects/p1/scratch", model: "/home/example-user-d4f0bc/project/scratch" },
    }
    expect(PathSpace.toModel(nested, "/data/projects/p1/scratch/x")).toBe("/home/example-user-d4f0bc/project/scratch/x")
    expect(PathSpace.toModel(nested, "/data/projects/p1/y")).toBe("/home/example-user-d4f0bc/project/y")
  })

  test("rewrites free text so tool output and errors agree with the roots", () => {
    const text = "File not found: /data/projects/p1/missing.csv (scratch: /data/workspaces/p1/s1/run.py)"
    expect(PathSpace.rewriteText(roots, text)).toBe(
      "File not found: /home/example-user-d4f0bc/project/missing.csv (scratch: /home/example-user-d4f0bc/scratch/run.py)",
    )
  })

  test("leaves text alone when the roots are host-spelled anyway", () => {
    const host = {
      project: { host: "/data/projects/p1", model: "/data/projects/p1" },
      scratch: { host: "/data/workspaces/p1/s1", model: "/data/workspaces/p1/s1" },
    }
    const text = "/data/projects/p1/a"
    expect(PathSpace.rewriteText(host, text)).toBe(text)
  })

  test("names connected folders with collision suffixes and keeps read access", () => {
    const granted = PathSpace.connectedRoots([
      { path: "/data/shared/img", access: "read", source: "permission", time: {} },
      { path: "/data/other/img", access: "write", source: "api", time: {} },
      { path: "/data/ignored", access: "write", source: "tool", time: {} },
      { path: "/data/revoked", access: "read", source: "api", time: { revoked: 1 } },
      { path: "/data/used", access: "read", source: "api", time: { consumed: 1 } },
    ])
    expect(granted).toEqual([
      { host: "/data/shared/img", model: "/home/example-user-d4f0bc/connected/img", access: "read" },
      { host: "/data/other/img", model: "/home/example-user-d4f0bc/connected/img-2", access: "write" },
    ])
  })

  test("rewrites the relocated home prefix alongside the roots", () => {
    const relocated = { ...roots, relocate: { from: "/data/home", to: "/home/example-user-d4f0bc" } }
    expect(PathSpace.rewriteText(relocated, "/data/home/example-user-d397a5/cache")).toBe("/home/example-user-d4f0bc/.axiomics/cache")
    expect(PathSpace.rewriteText(relocated, "/data/projects/p1/a")).toBe("/home/example-user-d4f0bc/project/a")
  })

  test("recognises only the synthetic home", () => {
    expect(PathSpace.mentions("/home/example-user-d4f0bc/project/a")).toBe(true)
    expect(PathSpace.mentions("/home/example-user-d4f0bc")).toBe(true)
    expect(PathSpace.mentions("/home/example-user-27d0d0/a")).toBe(false)
    expect(PathSpace.mentions("project/a")).toBe(false)
  })

  test("builds a complete payload environment with no host spelling left", () => {
    const view = {
      home: "/home/example-user-d4f0bc",
      cwd: "/home/example-user-d4f0bc/project",
      mounts: [],
      relocate: { from: "/data/home", to: "/home/example-user-d4f0bc" },
      env: { USER: "agent", LOGNAME: "agent" },
      roots,
    }
    const env = PathSpace.payloadEnv(view, {
      HOME: "/data/home",
      PATH: "/data/home/example-user-5d62ef/py/bin:/usr/bin",
      XDG_DATA_DIRS: "/data/home/example-user-a5d2f2/share/flatpak/exports/share:/usr/share",
      MAMBA_ROOT_PREFIX: "/data/home/example-user-d397a5/mamba",
      XDG_STATE_HOME: "/data/projects/p1/.axiomics/state",
      OPENAI_API_KEY: "sk-live-9f2c",
      LS_COLORS: "di=01;34:ln=01;36",
      USER: "dabiao",
    })
    expect(env.HOME).toBe("/home/example-user-d4f0bc")
    expect(env.PATH).toBe("/home/example-user-d4f0bc/envs/py/bin:/usr/bin")
    expect(env.XDG_DATA_DIRS).toBe("/home/example-user-d4f0bc/.local/share/flatpak/exports/share:/usr/share")
    expect(env.MAMBA_ROOT_PREFIX).toBe("/home/example-user-d4f0bc/.axiomics/mamba")
    expect(env.XDG_STATE_HOME).toBe("/home/example-user-d4f0bc/project/.axiomics/state")
    expect(env.OPENAI_API_KEY).toBe("sk-live-9f2c")
    expect(env.LS_COLORS).toBe("di=01;34:ln=01;36")
    expect(env.USER).toBe("agent")
    expect(env.LOGNAME).toBe("agent")
  })
})
