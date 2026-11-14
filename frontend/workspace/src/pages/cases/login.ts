/**
 * Login through Authelia's first-factor API instead of navigating to its
 * portal. The public entry is served from the same origin as `/auth`, so the
 * session cookie Authelia sets (`Path=/`) reaches the app without a page
 * redirect, and the gallery keeps its own chrome and language.
 *
 * The API contract is Authelia 4.39: JSON in, `200` plus `Set-Cookie` on
 * success, `401` on bad credentials, `403` when the regulation throttles the
 * client. Anything else is reported as unexpected rather than guessed.
 */
export type LoginFailure = "invalid" | "throttled" | "network" | "unexpected"

export type LoginResult = { ok: true } | { ok: false; reason: LoginFailure }

export async function submitLogin(input: {
  username: string
  password: string
  remember: boolean
}): Promise<LoginResult> {
  let response: Response
  try {
    response = await fetch("/auth/api/firstfactor", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        keepMeLoggedIn: input.remember,
      }),
    })
  } catch {
    return { ok: false, reason: "network" }
  }
  // A redirect means the edge answered with something other than the API
  // (expired config, proxy error). Treating it as success would send the user
  // into the app with no session.
  if (response.redirected) return { ok: false, reason: "unexpected" }
  if (response.ok) return { ok: true }
  if (response.status === 401) return { ok: false, reason: "invalid" }
  if (response.status === 403 || response.status === 429) return { ok: false, reason: "throttled" }
  return { ok: false, reason: "unexpected" }
}
