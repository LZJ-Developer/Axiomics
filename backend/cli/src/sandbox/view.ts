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
export const VIEW_RUNTIME = `${VIEW_HOME}/.runtime`
/** The shared omics environments as the model sees them. */
export const VIEW_ENVS = `${VIEW_RUNTIME}/envs`
/** Where the overlay wrapper mounts the per-project merged tree before bwrap
 * starts. Every wrapper owns a private mount namespace, so one fixed path is
 * safe even for concurrent projects. It lives under /tmp because that is the
 * one directory writable both on the host and in the tenant container; bwrap
 * resolves bind sources in the parent namespace, so its own /tmp tmpfs does
 * not hide it. */
export const ENV_OVERLAY_MOUNT = "/tmp/axiomics-env-overlay"

/** Mount an overlay with these lower/upper dirs at `mount` before bwrap starts.
 * bwrap 0.4–0.6 has no --overlay, so the merged tree is assembled one level
 * outside and bound in. A failed mount exits instead of falling through: the
 * whole point is that installs never reach the shared, read-only tree. */
export function overlayScript() {
  return [
    "set -e",
    'mkdir -p "$1" "$3" "$4"',
    'mount -t overlay overlay -o "lowerdir=$2,upperdir=$3,workdir=$4" "$1" 2>&1 || {',
    '  echo "axiomics: env overlay unavailable (lower=$2 upper=$3)" >&2',
    "  exit 97",
    "}",
    "shift 4",
    'exec "$@"',
  ].join("\n")
}

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
