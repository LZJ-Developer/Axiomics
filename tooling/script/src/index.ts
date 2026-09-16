import { $, semver } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  AXIOMICS_CHANNEL: process.env["AXIOMICS_CHANNEL"],
  AXIOMICS_BUMP: process.env["AXIOMICS_BUMP"],
  AXIOMICS_VERSION: process.env["AXIOMICS_VERSION"],
  AXIOMICS_RELEASE: process.env["AXIOMICS_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.AXIOMICS_CHANNEL) return env.AXIOMICS_CHANNEL
  if (env.AXIOMICS_BUMP) return "latest"
  if (env.AXIOMICS_VERSION && !env.AXIOMICS_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

const VERSION = await (async () => {
  if (env.AXIOMICS_VERSION) return env.AXIOMICS_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const pkg = (await Bun.file(new URL("../../../backend/cli/package.json", import.meta.url)).json()) as {
    version?: string
  }
  return pkg.version ?? "0.0.0"
})()

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release() {
    return env.AXIOMICS_RELEASE
  },
}
console.log(`axiomics script`, JSON.stringify(Script, null, 2))
