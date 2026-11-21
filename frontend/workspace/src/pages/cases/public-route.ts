/**
 * Parse the public cases entry hash route. `cases.html` is served as a static
 * file, so every case lives behind `#/replay/<id>` instead of a server route.
 *
 * The id is decoded once; callers must re-encode it before placing it in a URL
 * or file path. Malformed escapes yield `undefined` rather than throwing, which
 * keeps a bad link on the gallery instead of blanking the page.
 */
export function parseReplayHash(hash: string): string | undefined {
  const match = hash.match(/^#\/replay\/(.+)$/)
  if (!match) return
  try {
    return decodeURIComponent(match[1])
  } catch {
    return
  }
}

/**
 * The public entry has three views, all behind the hash: the gallery, a replay,
 * and the anonymous conversation that only asks for an account when the visitor
 * submits. A malformed replay hash falls back to the gallery rather than
 * blanking the page.
 */
export type PublicView = { kind: "gallery" } | { kind: "new" } | { kind: "replay"; id: string }

/** Where a completed login lands: the authenticated application entry. */
const APP_ENTRY = "/axiomics"

export function parsePublicHash(hash: string): PublicView {
  if (hash === "#/new") return { kind: "new" }
  const id = parseReplayHash(hash)
  if (id) return { kind: "replay", id }
  return { kind: "gallery" }
}

/**
 * Login target for the public entry. The portal is served by the same origin
 * under `/auth` (Authelia's server address carries a path), so deployments
 * that expose only the public port still work and the CTA cannot loop back to
 * the gallery: `/` without a session cookie is the static shell itself.
 *
 * `rd` points at the authenticated application entry rather than the page the
 * visitor came from: returning to `cases.html` after login would hit the app
 * with no such route. It is a **local path**, not an absolute URL, because the
 * SSO shim only accepts paths — an absolute one is dropped as a potential open
 * redirect and replaced by the shim's own default. The two agreeing matters:
 * the default happening to be `/axiomics` today is luck, not a contract.
 * Malformed input yields `undefined` so callers can fall back instead of
 * emitting a broken link.
 */
export function portalLoginHref(input: string): string | undefined {
  let origin: URL
  try {
    origin = new URL(input)
  } catch {
    return
  }
  // `about:blank` (and other opaque origins) have `origin === "null"`, which
  // `new URL("/auth", ...)` rejects. Callers fall back to a local link.
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return
  const portal = new URL("/auth", origin.origin).href
  return `${portal}?rd=${encodeURIComponent(APP_ENTRY)}`
}
