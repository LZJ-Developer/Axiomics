/** This distribution has no default hosted account, model proxy, or compute endpoint. */
export const DEFAULT_MANAGED_API_BASE = ""

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "")
}

export const MANAGED_API_BASE_ENV_KEYS = [
  "AXIOMICS_API_BASE",
  "MANAGED_API_BASE",
  "ATLAS_BASE_URL",
  "THESIS_BASE_URL",
] as const

export function managedApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const override = MANAGED_API_BASE_ENV_KEYS.map((key) => env[key]).find((value) => !!value)
  return stripTrailingSlashes(override || DEFAULT_MANAGED_API_BASE)
}

export function dashboardUrl(pathname: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = managedApiBase(env)
  if (!base) return "" // standalone build: no managed dashboard to link to
  const frontend = env.AXIOMICS_AUTH_URL?.trim() || base
  try {
    return new URL(pathname, `${stripTrailingSlashes(frontend)}/`).toString()
  } catch {
    return ""
  }
}

export const MANAGED_API_BASE = managedApiBase()
export const BILLING_URL = dashboardUrl("/billing")
