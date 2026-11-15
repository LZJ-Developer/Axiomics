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
// Whether the server has answered yet. `terminal` is a fail-open default above,
// so a caller that acts on it (anything that would hit /pty) has to wait for
// this: otherwise the first paint fires the request before the answer arrives
// and a deployment with the terminal switched off still sees one 403.
const [resolved, setResolved] = createSignal(false)

export const deploymentCapabilities = { terminal, locale, user, resolved }

/** Longest a caller should wait for the answer. Without it a hanging request
 * keeps `resolved()` false forever, and every surface that honours the
 * capability stays unrendered. */
const TIMEOUT_MS = 5000

export async function fetchDeploymentCapabilities(url: string): Promise<void> {
  try {
    const response = await fetch(`${url}/capabilities`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return
    const data = (await response.json()) as { terminal?: unknown; locale?: unknown; user?: unknown }
    if (typeof data.terminal === "boolean") setTerminal(data.terminal)
    if (typeof data.locale === "string" && data.locale) setLocale(data.locale)
    if (typeof data.user === "string" && data.user) setUser(data.user)
  } catch {
    // Keep the fail-open default.
  } finally {
    setResolved(true)
  }
}
