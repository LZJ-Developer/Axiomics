/**
 * Hand-off between the anonymous conversation and the workspace.
 *
 * The public entry and the workbench share one origin, so the question a
 * visitor typed before signing in can survive the login round trip in
 * localStorage. It is a draft only: the workspace prefills the composer and
 * waits for the analyst to send it, never submits on their behalf.
 */
const KEY = "axiomics-handoff"

export function saveDraft(text: string, storage: Storage = localStorage) {
  const value = text.trim()
  if (!value) return
  try {
    storage.setItem(KEY, value)
  } catch {
    // Storage can be unavailable (private mode, blocked site data). Login still
    // works; only the typed question is lost, which is not worth blocking on.
  }
}

/** Read once: the workspace consumes the draft so a later reload does not
 * refill the composer with an old question. */
export function takeDraft(storage: Storage = localStorage): string | undefined {
  try {
    const value = storage.getItem(KEY)
    if (value === null) return
    storage.removeItem(KEY)
    return value.trim() || undefined
  } catch {
    return
  }
}
