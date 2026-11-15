import { afterAll, describe, expect, test } from "bun:test"
import { deploymentCapabilities, fetchDeploymentCapabilities } from "./capabilities"

// The capability signals are module state, so these cases run in a fixed order:
// the fail-open ones first (they assert the defaults survive), the "switched
// off" answer last (it is the only one that changes them).
const real = globalThis.fetch

function stub(handler: () => Response) {
  globalThis.fetch = (async () => handler()) as unknown as typeof fetch
}

describe("deployment capabilities", () => {
  // Fail-open is deliberate: a server that predates /capabilities, or a network
  // blip, must not take the terminal away from a deployment that has one. But
  // the answer is still "resolved" — otherwise every surface that waits for it
  // waits forever.
  test("a failed fetch keeps the surface but still resolves", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch

    await fetchDeploymentCapabilities("https://edge.test")

    expect(deploymentCapabilities.resolved()).toBe(true)
    expect(deploymentCapabilities.terminal()).toBe(true)
  })

  test("a non-200 answer resolves without changing the defaults", async () => {
    stub(() => new Response("nope", { status: 503 }))

    await fetchDeploymentCapabilities("https://edge.test")

    expect(deploymentCapabilities.resolved()).toBe(true)
    expect(deploymentCapabilities.terminal()).toBe(true)
  })

  test("a deployment with the terminal switched off says so, and is resolved", async () => {
    stub(() => new Response(JSON.stringify({ terminal: false, locale: "zh-CN", user: "lzj" }), { status: 200 }))

    await fetchDeploymentCapabilities("https://edge.test")

    expect(deploymentCapabilities.resolved()).toBe(true)
    expect(deploymentCapabilities.terminal()).toBe(false)
    expect(deploymentCapabilities.locale()).toBe("zh-CN")
    expect(deploymentCapabilities.user()).toBe("lzj")
  })
})

afterAll(() => {
  globalThis.fetch = real
})
