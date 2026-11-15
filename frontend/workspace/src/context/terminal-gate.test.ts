import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const source = readFileSync(fileURLToPath(new URL("./terminal.tsx", import.meta.url)), "utf8")

/** The block that decides whether to list PTYs at all. */
function syncEffect() {
  const start = source.indexOf("const refresh = () =>")
  const end = source.indexOf("const removeExited")
  return source.slice(start, end)
}

describe("terminal sync honours the deployment switch", () => {
  // A deployment that runs without a terminal answers every /pty call with 403.
  // Listing first left a red error in the console on every page load for a
  // surface the UI already hides.
  test("does not list PTYs when the deployment has no terminal", () => {
    const effect = syncEffect()
    expect(effect).toContain("deploymentCapabilities.terminal()")
    expect(effect.indexOf("deploymentCapabilities.terminal()")).toBeLessThan(effect.indexOf("void refresh()"))
  })

  // `terminal()` is a fail-open default, so the capability check alone still
  // fires one request before the answer arrives. Waiting for `resolved()` is
  // what makes the disabled deployment quiet on a cold load.
  test("waits for the capability answer before the fail-open default is trusted", () => {
    const effect = syncEffect()
    expect(effect).toContain("deploymentCapabilities.resolved()")
    expect(effect.indexOf("deploymentCapabilities.resolved()")).toBeLessThan(effect.indexOf("void refresh()"))
  })
})
