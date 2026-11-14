import { describe, expect, test } from "bun:test"

const app = await Bun.file(new URL("../../app.tsx", import.meta.url)).text()
const appBase = await Bun.file(new URL("../../app-base.tsx", import.meta.url)).text()
const general = await Bun.file(new URL("../settings-general.tsx", import.meta.url)).text()
const preload = await Bun.file(new URL("../../../public/axiomics-theme-preload.js", import.meta.url)).text()
const theme = await Bun.file(new URL("../../../../ui/src/theme/context.tsx", import.meta.url)).text()
const index = await Bun.file(new URL("../../../index.html", import.meta.url)).text()

describe("Axiomics theme gallery", () => {
  test("starts with the product palette while preserving saved themes and display mode", () => {
    // ThemeProvider moved into the shared base providers so the public cases
    // entry can reuse it without the server/SDK graph.
    expect(app).toContain('import { AppBaseProviders } from "./app-base"')
    expect(appBase).toContain('<ThemeProvider')
    expect(appBase).toContain('defaultTheme="axiomics"')
    expect(appBase).not.toContain('lockedScheme="light"')
    expect(preload).toContain('localStorage.getItem("axiomics-theme-id") || "axiomics"')
    expect(preload).toContain('"axiomics-theme-css-" + themeId + "-" + mode')
    expect(preload).toContain('localStorage.getItem("axiomics-color-scheme") || "light"')
    expect(index).toContain('<meta name="theme-color" content="#f5f6f7" />')
    expect(preload).toContain('scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches')
    expect(preload).not.toContain('localStorage.setItem("axiomics-color-scheme", mode)')
    expect(preload).toContain("css.match(/--background-base:")
    expect(theme).toContain("lockedTheme?: string")
    expect(theme).toContain('lockedScheme?: Exclude<ColorScheme, "system">')
    // `initialScheme` is the display-only override used by the public entry; it
    // must win over the saved preference without being persisted.
    expect(theme).toContain('initialScheme?: Exclude<ColorScheme, "system">')
    expect(theme).toContain(
      'const initialScheme = lockedScheme ?? props.initialScheme ?? getStoredColorScheme() ?? "light"',
    )
    expect(theme).toContain('mode: initialScheme === "system" ? getSystemMode() : initialScheme')
    expect(theme).toContain("querySelector<HTMLMetaElement>('meta[name=\"theme-color\"]')")
    expect(theme).toContain("localStorage.removeItem(STORAGE_KEYS.LEGACY_THEME_CSS_LIGHT)")
    expect(theme).toContain("if (lockedTheme && id !== lockedTheme) return")
    expect(theme).toContain("if (lockedScheme && scheme !== lockedScheme) return")
  })

  test("offers theme and display-mode controls", () => {
    expect(general).toContain("theme.setColorScheme(option.value)")
    expect(general).toContain('role="group"')
    expect(general).toContain("aria-pressed={theme.colorScheme() === option.value}")
    expect(general).toContain('class="settings-segmented-control"')
    expect(general).toContain('class="settings-segmented-control__option"')
    expect(general).toContain('data-selected={theme.colorScheme() === option.value ? "true" : undefined}')
    expect(general).not.toContain("themeSwatches")
    expect(general).toContain("theme.setTheme(option.value)")
    expect(general).toContain('aria-label={language.t("settings.theme.title")}')
  })
})
