import { createSignal } from "solid-js"

/** Server-wide switches the client must honour before rendering a surface.
 * These are deployment policy, not user preference: a site that ships this
 * product as a web app for researchers sets it once, and every session on that
 * server behaves the same way. */
export type DeploymentCapabilities = {
  terminal: boolean
  locale: string | null
  /** Identity copied onto the request by the authenticating proxy. Null when
   * the server is reached directly (local development, no forward auth). */
  user: string | null
}

// Fail-open until the server answers. A local server that predates the
// capability endpoint, or a transient fetch failure, must not remove a surface
// the deployment actually has. A deployment that disables the terminal always
// answers, so the client hides it instead of offering a button that returns 403.
const [terminal, setTerminal] = createSignal(true)
// The locale a deployment starts in. Null means "let the browser decide".
const [locale, setLocale] = createSignal<string | null>(null)
// The signed-in identity the proxy reports. Null means "no forward auth".
const [user, setUser] = createSignal<string | null>(null)

export const deploymentCapabilities = { terminal, locale, user }

export async function fetchDeploymentCapabilities(url: string): Promise<void> {
  try {
    const response = await fetch(`${url}/capabilities`, { headers: { accept: "application/json" } })
    if (!response.ok) return
    const data = (await response.json()) as { terminal?: unknown; locale?: unknown; user?: unknown }
    if (typeof data.terminal === "boolean") setTerminal(data.terminal)
    if (typeof data.locale === "string" && data.locale) setLocale(data.locale)
    if (typeof data.user === "string" && data.user) setUser(data.user)
  } catch {
    // Keep the fail-open default.
  }
}
