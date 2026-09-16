import { BusEvent } from "@/bus/bus-event"
import path from "path"
import { $ } from "bun"
import z from "zod"
import { NamedError } from "@axiomics/util/error"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import fs from "node:fs/promises"
import os from "node:os"

declare global {
  const AXIOMICS_VERSION: string
  const AXIOMICS_CHANNEL: string
  const AXIOMICS_LIBC: string
  const AXIOMICS_PLATFORM_PACKAGE: string
  const AXIOMICS_ARTIFACT_SOURCE: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })
  const RELEASE_TIMEOUT_MS = 10_000

  function releaseFetch(input: string | URL | Request, init: RequestInit = {}) {
    return fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(RELEASE_TIMEOUT_MS),
    })
  }

  export type Method = Awaited<ReturnType<typeof method>>

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export async function info() {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export function methodFromPaths(input: { execPath: string; scriptPath?: string }) {
    const exec = input.execPath.replaceAll("\\", "/").toLowerCase()
    const script = (input.scriptPath ?? "").replaceAll("\\", "/").toLowerCase()
    const installed = `${exec}\n${script}`

    if (exec.includes("/.axiomics/bin/")) return "curl" as const
    // ~/.local/bin is ALSO npm's target with `--prefix ~/.local`, pipx, and many
    // package managers. Prefer the wrapper's own immutable location over
    // running package-manager discovery inside a user project: yarnPath,
    // npmrc, PATH, or similar project configuration must never execute during
    // a background update check.
    if (installed.includes("/.bun/install/global/")) return "bun" as const
    if (installed.includes("/.config/yarn/global/") || installed.includes("/yarn/global/")) return "yarn" as const
    if (installed.includes("/.pnpm/") || installed.includes("/pnpm/global/")) return "pnpm" as const
    if (installed.includes("/scoop/apps/axiomics/")) return "scoop" as const
    if (installed.includes("/chocolatey/")) return "choco" as const
    if (installed.includes("/cellar/axiomics/")) return "brew" as const
    if (installed.includes("/node_modules/@axiomics/axiomics-")) return "npm" as const
    if (script.includes("/node_modules/@axiomics/axiomics/")) return "npm" as const
    if (exec.includes("/.local/bin/")) return "curl" as const
    return "unknown" as const
  }

  export async function method() {
    if (process.env.AXIOMICS_DESKTOP_UPDATE_URL && process.env.AXIOMICS_DESKTOP_UPDATE_TOKEN) return "desktop" as const
    return methodFromPaths({ execPath: process.execPath, scriptPath: process.argv[1] })
  }

  export const UpgradeFailedError = NamedError.create(
    "UpgradeFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  export const DesktopUpdateState = z.object({
    phase: z.enum([
      "idle",
      "downloading",
      "extracting",
      "verifying",
      "ready",
      "restarting",
      "restart_blocked",
      "succeeded",
      "failed",
    ]),
    version: z.string().optional(),
    transferred: z.number().nonnegative().optional(),
    total: z.number().positive().optional(),
    progress: z.number().min(0).max(1).optional(),
    completed_at: z.string().optional(),
    error: z.string().optional(),
    migration_required: z.boolean().optional(),
  })
  export type DesktopUpdateState = z.infer<typeof DesktopUpdateState>

  async function desktopRequest(method: "GET" | "POST" | "DELETE", body?: unknown) {
    const url = process.env.AXIOMICS_DESKTOP_UPDATE_URL
    const token = process.env.AXIOMICS_DESKTOP_UPDATE_TOKEN
    if (!url || !token) throw new Error("The desktop update service is unavailable")
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      const message = await response
        .json()
        .then((value) => value.error)
        .catch(() => undefined)
      throw new UpgradeFailedError({ stderr: message ?? `Desktop update failed (${response.status})` })
    }
    return DesktopUpdateState.parse(await response.json())
  }

  export function desktopUpdateState() {
    return desktopRequest("GET")
  }

  export function stageDesktopUpdate(target: string) {
    return desktopRequest("POST", { action: "stage", version: target })
  }

  export function applyDesktopUpdate(target: string) {
    return desktopRequest("POST", { action: "apply", version: target })
  }

  export function cancelDesktopUpdate() {
    return desktopRequest("DELETE")
  }

  async function getBrewFormula() {
    const tapFormula = await $`brew list --formula axiomics/tap/axiomics`.throws(false).quiet().text()
    if (tapFormula.includes("axiomics")) return "axiomics/tap/axiomics"
    const coreFormula = await $`brew list --formula axiomics`.throws(false).quiet().text()
    if (coreFormula.includes("axiomics")) return "axiomics"
    return "axiomics"
  }

  export async function upgrade(method: Method, target: string) {
    if (method === "desktop") {
      await stageDesktopUpdate(target)
      log.info("desktop update staged", { target })
      return
    }
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "axiomics-upgrade-"))
    const allowed = [
      "PATH",
      "HOME",
      "USERPROFILE",
      "TMPDIR",
      "TMP",
      "TEMP",
      "SystemRoot",
      "COMSPEC",
      "PATHEXT",
      "APPDATA",
      "LOCALAPPDATA",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NO_PROXY",
      "https_proxy",
      "http_proxy",
      "no_proxy",
    ]
    const env = Object.fromEntries(allowed.flatMap((key) => (process.env[key] ? [[key, process.env[key]!]] : [])))
    let cmd
    switch (method) {
      case "curl": {
        const script = process.env.AXIOMICS_INSTALL_URL
        if (!script) throw new Error("Set AXIOMICS_INSTALL_URL to the install script to upgrade a script install")
        cmd = $`curl -fsSL ${script} | bash`
        break
      }
      case "npm":
        cmd = $`npm install -g @axiomics/axiomics@${target}`
        break
      case "pnpm":
        cmd = $`pnpm install -g @axiomics/axiomics@${target}`
        break
      case "yarn":
        cmd = $`yarn global add @axiomics/axiomics@${target}`
        break
      case "bun":
        cmd = $`bun install -g @axiomics/axiomics@${target}`
        break
      case "brew": {
        const formula = await getBrewFormula()
        cmd = $`brew upgrade ${formula}`
        break
      }
      case "choco":
        cmd = $`echo Y | choco upgrade axiomics --version=${target}`
        break
      case "scoop":
        cmd = $`scoop install axiomics@${target}`
        break
      default:
        throw new Error(`Unknown method: ${method}`)
    }
    const commandEnv =
      method === "curl"
        ? { ...env, VERSION: target }
        : method === "brew"
          ? { ...env, HOMEBREW_NO_AUTO_UPDATE: "1" }
          : env
    try {
      const result = await cmd.cwd(cwd).env(commandEnv).quiet().throws(false)
      if (result.exitCode !== 0) {
        const stderr =
          method === "choco" ? "not running from an elevated command shell" : result.stderr.toString("utf8")
        throw new UpgradeFailedError({
          stderr: stderr,
        })
      }
      log.info("upgraded", {
        method,
        target,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      })
      await $`${process.execPath} --version`.cwd(cwd).env(env).nothrow().quiet().text()
    } finally {
      await fs.rm(cwd, { recursive: true, force: true })
    }
  }

  export const VERSION = typeof AXIOMICS_VERSION === "string" ? AXIOMICS_VERSION : "local"
  export const CHANNEL = typeof AXIOMICS_CHANNEL === "string" ? AXIOMICS_CHANNEL : "local"
  export const ARTIFACT_SOURCE =
    typeof AXIOMICS_ARTIFACT_SOURCE === "string" && /^[a-f0-9]{40}$/.test(AXIOMICS_ARTIFACT_SOURCE)
      ? AXIOMICS_ARTIFACT_SOURCE
      : undefined
  export const USER_AGENT = `axiomics/${CHANNEL}/${VERSION}/${Flag.AXIOMICS_CLIENT}`
  export const PLATFORM_PACKAGE =
    typeof AXIOMICS_PLATFORM_PACKAGE === "string"
      ? AXIOMICS_PLATFORM_PACKAGE
      : `@axiomics/axiomics-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}${
          process.platform === "linux" && typeof AXIOMICS_LIBC === "string" && AXIOMICS_LIBC === "musl" ? "-musl" : ""
        }`

  /** OData query for the latest published version of a Chocolatey package.
   *  The id must match what the CLI actually publishes to Chocolatey
   *  (`axiomics`) — everywhere else in this file already uses it (`choco
   *  list --limit-output axiomics`, `choco upgrade axiomics`). A leftover
   *  pre-rename `axiomics` id here queried a non-existent package, so choco users
   *  could never resolve an upgrade target (`data.d.results[0]` was undefined). */
  export function chocoLatestVersionUrl(pkg: string = "axiomics"): string {
    const filter = encodeURIComponent(`Id eq '${pkg}' and IsLatestVersion`)
    return `https://community.chocolatey.org/api/v2/Packages?$filter=${filter}&$select=Version`
  }

  export function npmReleaseChannel(channel: string = CHANNEL) {
    const knownTags = new Set(["latest", "ci", "dev", "beta", "test"])
    return knownTags.has(channel) ? channel : "latest"
  }

  export async function latest(installMethod?: Method) {
    const detectedMethod = installMethod || (await method())

    if (detectedMethod === "brew") {
      return releaseFetch("https://formulae.brew.sh/api/formula/axiomics.json")
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.versions.stable)
    }

    if (
      detectedMethod === "npm" ||
      detectedMethod === "bun" ||
      detectedMethod === "pnpm" ||
      detectedMethod === "unknown"
    ) {
      const channel = npmReleaseChannel()
      return releaseFetch(`https://registry.npmjs.org/@axiomics/axiomics/${channel}`)
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    if (detectedMethod === "choco") {
      return releaseFetch(chocoLatestVersionUrl(), { headers: { Accept: "application/json;odata=verbose" } })
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.d.results[0].Version)
    }

    if (detectedMethod === "scoop") {
      return releaseFetch("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/axiomics.json", {
        headers: { Accept: "application/json" },
      })
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText)
          return res.json()
        })
        .then((data: any) => data.version)
    }

    return releaseFetch("https://api.github.com/repos/axiomics/axiomics/releases/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: any) => data.tag_name.replace(/^v/, ""))
  }
}
