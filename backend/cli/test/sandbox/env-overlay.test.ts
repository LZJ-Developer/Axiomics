import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Sandbox } from "../../src/sandbox/sandbox"

const shell = "/bin/sh"
const available = Sandbox.backend() === "bubblewrap"
const roots: string[] = []

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axiomics-overlay-"))
  roots.push(dir)
  return dir
}

afterEach(() => {
  // overlayfs marks its work directory mode 0000; its owner must loosen it
  // before a non-root recursive removal can descend.
  for (const root of roots.splice(0)) {
    try {
      fs.chmodSync(path.join(root, "work", "work"), 0o700)
    } catch {}
    for (const entry of fs.readdirSync(root)) {
      try {
        fs.chmodSync(path.join(root, entry, "work", "work"), 0o700)
      } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
})

async function run(plan: Sandbox.Plan, cwd: string) {
  const proc = Bun.spawn([plan.file, ...(plan.args ?? [])], { cwd, stdout: "pipe", stderr: "pipe" })
  const [exit, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  Sandbox.cleanup(plan)
  return { exit, stdout, stderr }
}

// The shared environment tree is one read-only copy for every project. A
// per-project overlay mounted outside bwrap is what lets an install land in
// that project without touching the shared tree — bwrap 0.4–0.6 has no
// --overlay, so this is the only mechanism available on the deployed images.
describe("env overlay", () => {
  test.skipIf(!available)("writes land in the project layer and the shared base is untouched", async () => {
    const tmp = { path: scratch() }
    const lower = path.join(tmp.path, "shared")
    const base = path.join(tmp.path, "project")
    fs.mkdirSync(path.join(lower, "omics-test", "bin"), { recursive: true })
    fs.writeFileSync(path.join(lower, "omics-test", "bin", "tool"), "original\n")

    const plan = Sandbox.plan({
      command: "cat omics-test/bin/tool; printf upgraded > omics-test/bin/tool; cat omics-test/bin/tool",
      shell,
      cwd: lower,
      workspace: [lower],
      envOverlay: {
        lower,
        target: lower,
        upper: path.join(base, "upper"),
        work: path.join(base, "work"),
      },
      options: { enabled: true, network: "deny" },
    })
    const result = await run(plan, lower)
    expect(result.exit, result.stderr).toBe(0)
    expect(result.stdout).toContain("original")
    expect(result.stdout).toContain("upgraded")

    // The write is visible through the overlay...
    expect(fs.readFileSync(path.join(base, "upper", "omics-test", "bin", "tool"), "utf8")).toBe("upgraded")
    // ...and the shared copy every project starts from is untouched.
    expect(fs.readFileSync(path.join(lower, "omics-test", "bin", "tool"), "utf8")).toBe("original\n")
  }, 20_000)

  test.skipIf(!available)("two projects see their own installs over one shared base", async () => {
    const tmp = { path: scratch() }
    const lower = path.join(tmp.path, "shared")
    fs.mkdirSync(path.join(lower, "omics-test"), { recursive: true })
    fs.writeFileSync(path.join(lower, "omics-test", "version"), "1.0\n")

    const project = (name: string) => ({
      lower,
      target: lower,
      upper: path.join(tmp.path, name, "upper"),
      work: path.join(tmp.path, name, "work"),
    })
    const install = async (name: string, version: string) => {
      const plan = Sandbox.plan({
        command: `printf ${version} > omics-test/version; cat omics-test/version`,
        shell,
        cwd: lower,
        workspace: [lower],
        envOverlay: project(name),
        options: { enabled: true, network: "deny" },
      })
      return run(plan, lower)
    }

    const first = await install("alpha", "2.0")
    const second = await install("beta", "3.0")
    expect(first.stdout).toContain("2.0")
    expect(second.stdout).toContain("3.0")

    const read = async (name: string) => {
      const plan = Sandbox.plan({
        command: "cat omics-test/version",
        shell,
        cwd: lower,
        workspace: [lower],
        envOverlay: project(name),
        options: { enabled: true, network: "deny" },
      })
      return run(plan, lower)
    }
    expect((await read("alpha")).stdout).toContain("2.0")
    expect((await read("beta")).stdout).toContain("3.0")
    expect(fs.readFileSync(path.join(lower, "omics-test", "version"), "utf8")).toBe("1.0\n")
  }, 30_000)
})
