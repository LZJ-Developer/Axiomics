import { timingSafeEqual } from "../util/timing-safe"

// The local axiomics server only ever binds to loopback. Independent checks
// gate every NETWORK request (in-process callers bypass them via a per-process
// nonce header — see Server.internalFetch):
//
//   isAllowedHost   — rejects DNS-rebinding. An attacker page on evil.com that
//     rebinds its domain to 127.0.0.1 still sends `Host: evil.com`; browsers
//     cannot forge the Host header, so only loopback hosts pass. Bun derives
//     the request URL from the Host header, so deriving the host from the URL
//     (for the rare header-less client) is equally safe.
//
//   isAllowedOrigin — rejects plain cross-origin requests AND cross-origin
//     WebSocket upgrades (which CORS does not cover). A page on evil.com that
//     fetches http://localhost:<port> directly sends `Host: localhost` (passing
//     the host check) but `Origin: https://evil.com`. Only the local UI, the
//     desktop (tauri) shell, and explicitly configured CORS domains are
//     allowed. This MUST stay in lockstep with the cors() policy
//     in server.ts (the cors middleware reuses this function).

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

function allowedApexDomains(): string[] {
  return (process.env["AXIOMICS_CORS_DOMAINS"] ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
}

function matchesAllowedSubdomain(origin: string): boolean {
  for (const apex of allowedApexDomains()) {
    const escaped = apex.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // <subdomain>.<apex> (https only). The bare apex is NOT trusted (it may
    // carry marketing pages / third-party tags), so a subdomain label is
    // required (`+`, not `*`).
    if (new RegExp(`^https://[a-z0-9-]+\\.${escaped}$`).test(origin)) return true
  }
  return false
}

export function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  const host = hostHeader.startsWith("[")
    ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) // keep "[::1]" bracket form
    : hostHeader.split(":")[0]
  return ALLOWED_HOSTS.has(host)
}

export function isAllowedOrigin(origin: string, extraWhitelist: string[] = []): boolean {
  if (origin.startsWith("http://localhost:") || origin === "http://localhost") return true
  if (origin.startsWith("http://127.0.0.1:") || origin === "http://127.0.0.1") return true
  if (origin === "tauri://localhost" || origin === "http://tauri.localhost") return true
  // User-configured hosted UI subdomains. There is no built-in hosted origin.
  if (matchesAllowedSubdomain(origin)) return true
  return extraWhitelist.includes(origin)
}

// A top-level navigation is the one request shape a browser sends without an
// Origin header. Restricting the exemption to safe methods keeps it honest:
// a cross-site form POST is also `mode=navigate` but arrives with
// `Origin: <attacker>`, so the allow-list above still judges it.
export function isTopLevelNavigation(secFetchMode: string | undefined, method: string | undefined): boolean {
  if (secFetchMode !== "navigate") return false
  return method === "GET" || method === "HEAD"
}

// Decide whether a NETWORK request is cross-origin and must be rejected. An
// Origin header (always present on cross-origin fetch and WebSocket upgrades)
// is checked against the allow-list; when it is absent (same-origin requests
// and same-/cross-site GET navigations omit it) we fall back to Sec-Fetch-Site
// and reject only explicit cross-site contexts.
//
// A cross-site GET navigation is not cross-origin in the sense this guard
// cares about: the initiator cannot read the response (same-origin policy) and
// the request mutates nothing, so a link, bookmark or notification from any
// other site may land in the workspace. Without the `navigation` exemption a
// top-level navigation from another site is answered with the 403 JSON *as the
// page*, which is what users see as a blank "Forbidden origin" document.
// Non-browser clients send neither header and are allowed (the loopback bind
// already gates them).
export function isCrossOrigin(
  origin: string | undefined,
  secFetchSite: string | undefined,
  extraWhitelist: string[] = [],
  navigation = false,
): boolean {
  if (origin !== undefined) return !isAllowedOrigin(origin, extraWhitelist)
  if (navigation) return false
  return secFetchSite === "cross-site"
}

export function isCorsPreflight(
  method: string,
  origin: string | undefined,
  requestedMethod: string | undefined,
): boolean {
  return method === "OPTIONS" && origin !== undefined && requestedMethod !== undefined
}

/** Verify the optional deployment credential without changing local defaults. */
export function isDeploymentAuthorized(token: string | undefined, authorization: string | undefined): boolean {
  if (!token) return true
  if (!authorization || authorization.slice(0, 7).toLowerCase() !== "bearer ") return false
  return timingSafeEqual(authorization.slice(7), token)
}
