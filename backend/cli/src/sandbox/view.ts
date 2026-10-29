import path from "path"

/**
 * The vocabulary of the machine the model is shown.
 *
 * These constants and the prefix rewrite that follows are the only place the
 * synthetic layout is spelled out. The sandbox module needs the same strings to
 * place mounts and the private temp root; the session module needs them to
 * translate text and environment values. Keeping them here avoids two modules
 * quietly disagreeing about where the home is.
 */
export const VIEW_HOME = "/home/example-user-d4f0bc"
export const VIEW_TMP = `${VIEW_HOME}/.tmp`

export type Relocation = { from: string; to: string }

/** Rewrite a single path or colon-less string from the host home prefix to the
 * synthetic one. Lexical on purpose: callers that must agree with a real path
 * resolve it first and then ask for the rewrite. */
export function relocate(relocation: Relocation | undefined, value: string) {
  if (!relocation || relocation.from === "/" || relocation.from === relocation.to) return value
  if (value === relocation.from) return relocation.to
  if (value.startsWith(relocation.from + path.sep)) return relocation.to + value.slice(relocation.from.length)
  return value
}

/** Rewrite each colon-separated segment of a path list. */
export function relocateList(relocation: Relocation | undefined, value: string) {
  if (!relocation) return value
  return value.split(":").map((segment) => relocate(relocation, segment)).join(":")
}
