import { describe, expect, test } from "bun:test"
import { SETTINGS_PANELS, SETTINGS_PANEL_IDS, SETTINGS_SECTIONS } from "./registry"

const root = new URL("./", import.meta.url)
const modules: Record<(typeof SETTINGS_PANEL_IDS)[number], string> = {
  skills: "Skills",
  "scientific-tools": "ScientificTools",
  permissions: "Permissions",
  network: "Network",
  sandbox: "Sandbox",
  storage: "Storage",
  general: "General",
}

describe("settings registry source contract", () => {
  test("enumerates every reachable panel once and in rail order", () => {
    expect(SETTINGS_PANELS.map((panel) => panel.id)).toEqual([...SETTINGS_PANEL_IDS])
    expect(new Set(SETTINGS_PANELS.map((panel) => panel.id)).size).toBe(SETTINGS_PANEL_IDS.length)

    for (const section of SETTINGS_SECTIONS) {
      expect(
        SETTINGS_PANELS.some((panel) => panel.section === section.id),
        section.id,
      ).toBe(true)
    }
  })

  test("keeps every destination visible in the grouped rail", () => {
    expect(SETTINGS_PANELS.map((panel) => panel.title)).toEqual([
      "Skills",
      "Tools",
      "Permissions",
      "Network",
      "Sandbox",
      "Storage",
      "General",
    ])
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual(["Capabilities", "Runtime", "App"])
    expect(SETTINGS_PANELS.every((panel) => "parent" in panel === false)).toBe(true)
  })

  test("keeps every panel inside the shared settings frame", async () => {
    for (const id of SETTINGS_PANEL_IDS) {
      const source = await Bun.file(new URL(`${modules[id]}.tsx`, root)).text()
      if (id === "skills") {
        expect(source, id).toContain("<SkillsFrame")
        continue
      }
      expect(source, id).toContain("<PanelScroll>")
      expect(source, id).toContain("<PanelHeader")
      expect(source, id).toContain("<PanelBody>")
    }
  })

  test("keeps the general surface in the audited source set", async () => {
    const general = await Bun.file(new URL("General.tsx", root)).text()

    expect(general).toContain("<AppearanceSections")
    expect(general).not.toContain('title="Ace account"')
    expect(general).not.toContain('"/account/login-browser"')
    expect(general).not.toContain('title="Navigation"')
    expect(general).not.toContain('title="Gateway"')
    expect(general).not.toContain('title="Trace"')
    expect(general).not.toContain("atlas_enabled")
    expect(general).not.toContain("show_trace")
  })

  test("keeps removed inference and integration destinations out of the rail", () => {
    for (const id of ["models", "local-models", "compute", "credentials", "connectors"]) {
      expect(SETTINGS_PANEL_IDS).not.toContain(id as never)
    }
    expect(SETTINGS_SECTIONS.map((section) => section.id)).not.toContain("inference" as never)
    for (const title of ["Models", "Local models", "Compute", "Credentials", "Connectors"]) {
      expect(SETTINGS_PANELS.map((panel) => panel.title)).not.toContain(title)
    }
  })

  test("keeps specialist and memory implementations unavailable from the settings surface", () => {
    expect(SETTINGS_PANEL_IDS).not.toContain("specialists" as never)
    expect(SETTINGS_PANEL_IDS).not.toContain("memory" as never)
    expect(SETTINGS_PANELS.map((panel) => panel.title)).not.toContain("Specialists")
    expect(SETTINGS_PANELS.map((panel) => panel.title)).not.toContain("Memory")
  })

  test("keeps research controls in the composer instead of duplicating a settings destination", () => {
    expect(SETTINGS_PANEL_IDS).not.toContain("research-tools" as never)
    expect(SETTINGS_PANELS.map((panel) => panel.title)).not.toContain("Research tools")
  })
})
