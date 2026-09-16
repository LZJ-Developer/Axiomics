import fs from "fs/promises"
import { readFileSync } from "fs"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { resolveDataDirectory } from "./data-dir"
import { DataRoot } from "./data-root"
import { DataRootBarrier } from "./data-root-barrier"

const app = "axiomics"

function override(key: string): string | undefined {
  const value = process.env[key]?.trim()
  return value ? path.resolve(value) : undefined
}

const cache = path.join(xdgCache!, app)
const config = override("AXIOMICS_CONFIG_DIR") ?? path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

// The data directory can be relocated from settings ▸ Storage. When a pointer
// file exists (config/data-location) we honour it; otherwise ~/.axiomics.
// Resolve once at boot so every Global.Path.data consumer sees one value.
const explicit = override("AXIOMICS_DATA_DIR")
const storedPointer = (() => {
  try {
    return readFileSync(path.join(config, "data-location"), "utf8").trim() || undefined
  } catch {
    return
  }
})()
const anchored = explicit ? undefined : await DataRoot.active(config)
const pointer = anchored ?? storedPointer
const previous = path.join(xdgData!, app)
const resolved = await resolveDataDirectory({
  home: process.env.AXIOMICS_TEST_HOME || os.homedir(),
  legacy: previous,
  explicit,
  pointer,
})
const selected = await DataRoot.ensure(config, resolved.path, !!explicit)
const data = selected.path
DataRootBarrier.configure({ root: data, config })

// The stable link is authoritative. Reconcile the compatibility pointer after
// an interrupted switch so an older Axiomics build selects the same root.
if (selected.managed) {
  const defaultRoot = await fs
    .realpath(path.join(process.env.AXIOMICS_TEST_HOME || os.homedir(), ".axiomics"))
    .catch(() => path.resolve(process.env.AXIOMICS_TEST_HOME || os.homedir(), ".axiomics"))
  const pointerPath = path.join(config, "data-location")
  if (selected.target === defaultRoot) {
    await fs.rm(pointerPath, { force: true }).catch(() => undefined)
  } else if (storedPointer !== selected.target) {
    const temporary = `${pointerPath}.${process.pid}.${crypto.randomUUID()}.tmp`
    await Bun.write(temporary, `${selected.target}\n`, { mode: 0o600 })
    await fs.rename(temporary, pointerPath).catch(async (error) => {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    })
  }
}

export namespace Global {
  export const LegacyConflicts: readonly { legacy: string; current: string }[] = []
  export const DataMigration = resolved
  /** The XDG data directory earlier releases used. The import copies out of it
   *  rather than moving, so it survives as a safety copy — and, left alone,
   *  as a permanent duplicate nothing ever tells the user they can delete.
   *  `axiomics doctor` reports it and can remove it. Undefined once the
   *  data root is the same directory or the user has cleaned it up. */
  export const LegacyData = previous === selected.target ? undefined : previous
  export const Path = {
    // Allow override via AXIOMICS_TEST_HOME for test isolation
    get home() {
      return process.env.AXIOMICS_TEST_HOME || os.homedir()
    },
    data,
    dataManaged: selected.managed,
    /** Current physical destination behind the stable data-root link. */
    get dataTarget() {
      return selected.managed ? fs.realpath(data).catch(() => selected.target) : Promise.resolve(selected.target)
    },
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,
    config,
    state,
  }
}

await Promise.all([
  fs.mkdir(Global.Path.data, { recursive: true }),
  fs.mkdir(Global.Path.config, { recursive: true }),
  fs.mkdir(Global.Path.state, { recursive: true }),
  fs.mkdir(Global.Path.log, { recursive: true }),
  fs.mkdir(Global.Path.bin, { recursive: true }),
])

const CACHE_VERSION = "21"

const version = await Bun.file(path.join(Global.Path.cache, "version"))
  .text()
  .catch(() => "0")

if (version !== CACHE_VERSION) {
  try {
    const contents = await fs.readdir(Global.Path.cache)
    await Promise.all(
      contents.map((item) =>
        fs.rm(path.join(Global.Path.cache, item), {
          recursive: true,
          force: true,
        }),
      ),
    )
  } catch (e) {}
  await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
}
