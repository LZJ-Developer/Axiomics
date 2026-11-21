/**
 * Signing out of a deployment that sits behind an authenticating proxy.
 *
 * The workspace never holds the user's identity: the gateway authenticates the
 * request with CAS (through the SSO shim) and swaps the identity for a tenant
 * token before the app sees it. So there is nothing here to "log out" of — the
 * session lives in the shim's cookie. What this origin does own is the copy of
 * the previous account's data sitting in web storage, which the next account
 * must not see.
 *
 * Order matters: storage is cleared first so a failed or slow logout request
 * cannot leave that copy behind.
 *
 * The redirect carries `?signedout=1` because clearing our cookie does NOT end
 * the CAS session: clicking "start" again returns silently, without a password.
 * On a shared machine that means this button protects the data copy, not the
 * browser. The gallery says so in words; see ADR 0005.
 */

// Device preferences survive an account switch — the theme belongs to the
// screen, not to the person signed in.
const KEPT = ["axiomics-theme"]

export function forgetAccount(local: Storage, session: Storage) {
  const doomed: string[] = []
  for (let index = 0; index < local.length; index++) {
    const key = local.key(index)
    if (!key?.startsWith("axiomics")) continue
    if (KEPT.some((prefix) => key.startsWith(prefix))) continue
    doomed.push(key)
  }
  for (const key of doomed) local.removeItem(key)
  session.clear()
}

/**
 * Ends this site's session and returns to the public page. `/auth` is handled
 * by the gateway ahead of forward auth, so this resolves even when the current
 * account has already been disabled.
 */
export async function signOut() {
  forgetAccount(localStorage, sessionStorage)
  await fetch("/auth/api/logout", { method: "POST", credentials: "include" }).catch(() => undefined)
  location.replace("/?signedout=1")
}
