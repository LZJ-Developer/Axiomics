import { describe, expect, test } from "bun:test"

const publicSources = [
  "../pages/session-sidebar-action.tsx",
  "../pages/session.tsx",
  "../pages/home-workbench.tsx",
  "../pages/home.tsx",
  "../atlas/RightPane.tsx",
  "../atlas/kernel-runtime.ts",
  "../i18n/zh.ts",
  "./settings/General.tsx",
] as const

function renderedSource(value: string) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*import\s.*$/gm, "")
}

describe("public Axiomics branding", () => {
  test("retains internal Atlas component names without rendering the old standalone brand", async () => {
    const violations: string[] = []
    for (const file of publicSources) {
      // Expression Atlas and Human Protein Atlas are external database names
      // the network allowlist shows verbatim; they are not the retired brand.
      const source = renderedSource(await Bun.file(new URL(file, import.meta.url)).text())
        .replaceAll("Expression Atlas", "")
        .replaceAll("Human Protein Atlas", "")
      if (/\bAtlas\b/.test(source)) violations.push(file)
    }
    expect(violations).toEqual([])
  })

  test("does not render Gateway as the Axiomics product name", async () => {
    const violations: string[] = []
    for (const file of publicSources) {
      const source = renderedSource(await Bun.file(new URL(file, import.meta.url)).text()).replaceAll("AI Gateway", "")
      if (/\bGateway\b/.test(source)) violations.push(file)
    }
    expect(violations).toEqual([])
  })
})
