import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")

describe("case replay mount points", () => {
  // The player renders a compaction component that resolves DiffComponent from
  // context. Mounting PublicReplay bare throws into the top-level error
  // boundary, which the user sees as "Workspace recovery" instead of the case.
  test("every entry mounts the replay through the provider shell", () => {
    const app = read("../../app.tsx")
    const entry = read("../../cases-entry.tsx")

    for (const source of [app, entry]) {
      expect(source).toContain('import("@/pages/cases/public-replay-shell")')
      expect(source).not.toContain('import("@/pages/cases/public-replay")')
    }
  })

  test("the shell wraps the replay in the session render providers", () => {
    const shell = read("./public-replay-shell.tsx")
    const providers = shell.indexOf("<SessionRenderProviders>")
    const replay = shell.indexOf("<PublicReplay")

    expect(providers).toBeGreaterThan(-1)
    expect(replay).toBeGreaterThan(providers)
    // The workbench route passes embedded; dropping it loses the workbench
    // chrome on /cases/<id> without failing any render.
    expect(shell).toContain("embedded={props.embedded}")
  })
})
