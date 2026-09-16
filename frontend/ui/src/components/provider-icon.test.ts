import { describe, expect, test } from "bun:test"

describe("Axiomics provider mark", () => {
  test("uses the same local company vector in the source asset and rendered sprite", async () => {
    const asset = await Bun.file(new URL("../assets/icons/provider/axiomics.svg", import.meta.url)).text()
    const sprite = await Bun.file(new URL("./provider-icons/sprite.svg", import.meta.url)).text()
    const symbol = sprite.match(/<symbol[^>]*id="axiomics"[^>]*>[\s\S]*?<\/symbol>/)?.[0]

    expect(symbol).toBeDefined()
    expect(asset).toContain('aria-label="Axiomics"')
    expect(asset.match(/<path[^>]* d="([^"]+)"/)?.[1]).toBeDefined()
    expect(symbol?.match(/viewBox="([^"]+)"/)?.[1]).toBe(asset.match(/viewBox="([^"]+)"/)?.[1])
    expect(symbol?.match(/<path[^>]* d="([^"]+)"/)?.[1]).toBe(asset.match(/<path[^>]* d="([^"]+)"/)?.[1])
    expect(symbol).toContain('fill="currentColor"')
    expect(symbol).not.toContain("<image")
  })
})
