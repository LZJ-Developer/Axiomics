import { describe, expect, spyOn, test } from "bun:test"
import { CapabilityRuntime } from "../../src/science/capability/runtime"
import { CapabilityRegistry } from "../../src/science/capability/registry"
import { ScientificToolsSettingsRoutes } from "../../src/server/routes/settings/scientific-tools"

describe("scientific tools settings catalog", () => {
  test("returns the complete truthful capability and reviewed connector inventory", async () => {
    const response = await ScientificToolsSettingsRoutes().request("/")
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      schema_version: number
      capabilities: Array<{
        id: string
        maturity: string
        current_availability: { local: string; hosted: string }
      }>
      connectors: Array<{ id: string; writes_enabled_by_catalog: boolean; revision: string }>
      counts: {
        total: number
        packaged: number
        hosted: number
        verified: number
        experimental: number
        blocked: number
      }
    }

    expect(body.schema_version).toBe(1)
    expect(body.capabilities).toHaveLength(65)
    expect(body.counts).toEqual({
      total: 65,
      packaged: 16,
      hosted: 10,
      verified: 0,
      experimental: 63,
      blocked: 2,
    })
    expect(body.connectors.map((entry) => entry.id)).toEqual([
      "givemeanode",
      "github",
      "benchling",
      "box",
      "dropbox",
      "s3",
    ])
    expect(body.connectors.every((entry) => entry.writes_enabled_by_catalog === false)).toBe(true)
    expect(body.connectors.every((entry) => /^[a-f0-9]{64}$/.test(entry.revision))).toBe(true)
    expect(
      body.capabilities.every((entry) =>
        ["ready", "configured", "setup_needed", "degraded", "unavailable", "not_applicable"].includes(
          entry.current_availability.hosted,
        ),
      ),
    ).toBe(true)
    const squidpy = CapabilityRegistry.describe("squidpy")!
    const current = await CapabilityRuntime.availability(squidpy, { verification: "status" })
    expect(body.capabilities.find((entry) => entry.id === "squidpy")?.current_availability).toEqual(current)
  })

  test("installs only a real packaged local capability", async () => {
    const setup = spyOn(CapabilityRuntime, "setup").mockImplementation(async (manifest) => {
      if (manifest.runtime?.kind !== "python_pack") throw new Error("Expected Python fixture runtime")
      return {
        capability: manifest.id,
        state: "ready" as const,
        environment: manifest.runtime.pack_id,
        python: manifest.runtime.python,
        packages: { scipy: "1.18.1" },
        lock_digest: manifest.runtime.lock_digest,
        conda_lock_sha256: "fixture-lock",
      }
    })
    try {
      const installed = await ScientificToolsSettingsRoutes().request("/scipy/setup", { method: "POST" })
      expect(installed.status).toBe(200)
      expect(await installed.json()).toMatchObject({ capability: "scipy", state: "ready" })
      expect(setup).toHaveBeenCalledTimes(1)

      const inventoryOnly = await ScientificToolsSettingsRoutes().request("/open-babel/setup", { method: "POST" })
      expect(inventoryOnly.status).toBe(409)
      expect(await inventoryOnly.json()).toMatchObject({ error: "not_installable" })
      expect(setup).toHaveBeenCalledTimes(1)

      const missing = await ScientificToolsSettingsRoutes().request("/does-not-exist/setup", { method: "POST" })
      expect(missing.status).toBe(404)
      expect(await missing.json()).toMatchObject({ error: "not_found" })
    } finally {
      setup.mockRestore()
    }
  })
})
