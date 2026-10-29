import { describe, expect, test } from "bun:test"

const root = new URL("./", import.meta.url)
const read = (path: string) => Bun.file(new URL(path, root)).text()

const panels = ["ScientificTools.tsx", "Network.tsx", "Permissions.tsx", "Sandbox.tsx", "Storage.tsx", "General.tsx"]

describe("settings panel layout contract", () => {
  test("lets shared card and row primitives own their boundaries", async () => {
    for (const path of panels) {
      const source = await read(path)
      const cards = source.match(/class="[^"]*\bsettings-card\b[^"]*"/g) ?? []
      const rows = source.match(/class="[^"]*\bsettings-row\b[^"]*"/g) ?? []

      for (const card of cards) {
        expect(card.match(/\bborder\s/), `${path}: ${card}`).toBeNull()
        expect(card.includes("border-border-weak-base"), `${path}: ${card}`).toBe(false)
      }
      for (const row of rows) {
        expect(row.match(/\bborder-[bt](?:\s|\b)/), `${path}: ${row}`).toBeNull()
        expect(row.includes("border-border-weak-base/"), `${path}: ${row}`).toBe(false)
      }
      expect(source.includes('class="settings-card settings-row'), path).toBe(false)
      expect(source.includes('class="settings-list-row settings-row'), path).toBe(false)
    }
  })

  test("keeps shared controls and panel containers shrinkable", async () => {
    const source = await read("_shared.tsx")

    expect(source).toContain('class="flex min-h-0 min-w-0 flex-col h-full overflow-y-auto no-scrollbar"')
    expect(source).toContain('class="settings-page-body min-w-0"')
    expect(source).toContain('class="min-w-0 flex-1 bg-transparent')
    expect(source).toContain('class="settings-toolbar min-w-0"')
  })

  test("guards long settings values and dense action groups", async () => {
    const network = await read("Network.tsx")
    const storage = await read("Storage.tsx")

    expect(network).toContain("max-w-full break-all whitespace-normal")
    expect(network).toContain("min-w-0 flex-1 basis-[220px] font-mono")
    expect(storage).toContain("min-w-0 flex-1 basis-[240px]")
  })
})
