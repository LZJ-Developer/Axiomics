import { lazy, type Component } from "solid-js"
import type { IconProps } from "@axiomics/ui/icon"
import type { dict as en } from "@/i18n/en"

// ── Panel contract ──────────────────────────────────────────────────────────
//
// Every settings panel is a lazily-loaded SolidJS component keyed by a stable
// `id`. The shell preloads the default panel before the dialog opens, warms
// likely destinations during idle or navigation intent, and retains panels
// after their first visit. Panel authors own exactly one file —
// `components/settings/<Panel>.tsx`
// — and `export default` a `Component`. The shell (dialog-settings.tsx) renders
// the header (back/forward + title + expand/close) and the left rail from this
// registry; the panel component only renders its own scrollable body.
//
// To add real behaviour a panel either:
//   • calls an existing local-server endpoint via the SDK (`useSDK().client.*`
//     or `useGlobalSDK().client.*`), or
//   • ships a NEW minimal backend route at
//     `backend/cli/src/server/routes/settings/<name>.ts` (export a Hono route;
//     mount it in `backend/cli/src/server/server.ts`) that persists to a JSON
//     config store — so the control does something real.
//
// HARD RULE: no dead buttons. A panel either wires to a real backend or omits
// the control. Placeholder panels below ship with zero interactive controls.

export type SettingsSection = "capabilities" | "runtime" | "app"

// Source contract for every reachable Settings destination. Keep this list in
// rail order; the registry contract test verifies that no panel can be added,
// removed, or left without the shared layout audit silently.
export const SETTINGS_PANEL_IDS = [
  "skills",
  "scientific-tools",
  "permissions",
  "network",
  "sandbox",
  "storage",
  "general",
] as const

export type SettingsPanelId = (typeof SETTINGS_PANEL_IDS)[number]

export interface SettingsPanel {
  /** Stable key used for routing/history. */
  id: SettingsPanelId
  /** Title shown in the shell header + rail label. */
  title: string
  /** Translation key for {@link title}. */
  titleKey: keyof typeof en
  /** Icon name from `@axiomics/ui/icon`. */
  icon: IconProps["name"]
  /** Which rail group the row lives under. */
  section: SettingsSection
  /** Lazily-loaded panel body (default export of the file). */
  component: Component & { preload?: () => Promise<unknown> }
}

// Order here is the render order in the rail (top→bottom within each section).
export const SETTINGS_PANELS: SettingsPanel[] = [
  // ── Capabilities ──
  {
    id: "skills",
    title: "Skills",
    titleKey: "settings.panel.skills",
    icon: "flask",
    section: "capabilities",
    component: lazy(() => import("./Skills")),
  },
  {
    id: "scientific-tools",
    title: "Tools",
    titleKey: "settings.panel.scientificTools",
    icon: "atom",
    section: "capabilities",
    component: lazy(() => import("./ScientificTools")),
  },
  // ── Runtime ──
  {
    id: "permissions",
    title: "Permissions",
    titleKey: "settings.panel.permissions",
    icon: "shield",
    section: "runtime",
    component: lazy(() => import("./Permissions")),
  },
  {
    id: "network",
    title: "Network",
    titleKey: "settings.panel.network",
    icon: "server",
    section: "runtime",
    component: lazy(() => import("./Network")),
  },
  {
    id: "sandbox",
    title: "Sandbox",
    titleKey: "settings.panel.sandbox",
    icon: "code",
    section: "runtime",
    component: lazy(() => import("./Sandbox")),
  },
  // ── App ──
  {
    id: "storage",
    title: "Storage",
    titleKey: "settings.panel.storage",
    icon: "folder",
    section: "app",
    component: lazy(() => import("./Storage")),
  },
  {
    id: "general",
    title: "General",
    titleKey: "settings.panel.general",
    icon: "sliders",
    section: "app",
    component: lazy(() => import("./General")),
  },
]

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string; labelKey: keyof typeof en }[] = [
  { id: "capabilities", label: "Capabilities", labelKey: "settings.section.capabilities" },
  { id: "runtime", label: "Runtime", labelKey: "settings.section.runtime" },
  { id: "app", label: "App", labelKey: "settings.section.app" },
]

export function findPanel(id: SettingsPanelId): SettingsPanel {
  return SETTINGS_PANELS.find((p) => p.id === id) ?? SETTINGS_PANELS[0]
}

export async function preloadPanel(id: SettingsPanelId): Promise<void> {
  await findPanel(id).component.preload?.()
}

export const DEFAULT_PANEL: SettingsPanelId = "general"
