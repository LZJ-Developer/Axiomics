import { Global } from "@/global"
import { FileLease } from "@/util/file-lease"
import crypto from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import type { CapabilityRuntime } from "./schema"

type Runtime = Extract<CapabilityRuntime, { kind: "managed_toolchain" }>

const Attestation = z
  .object({
    path: z.string().trim().min(1).max(240),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

const Receipt = z
  .object({
    version: z.literal(1),
    pack_id: z.string().trim().min(1).max(120),
    root: z.string().trim().min(1).refine(path.isAbsolute),
    lock_digest: z.string().regex(/^[a-f0-9]{64}$/),
    entrypoint_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    attestations: Attestation.array().default([]),
    components: z.record(z.string(), z.string()),
    verified_at: z.string().datetime(),
  })
  .strict()

const Registry = z
  .object({
    version: z.literal(1),
    toolchains: z.record(z.string(), Receipt),
  })
  .strict()

const file = () =>
  process.env.AXIOMICS_TOOLCHAIN_REGISTRY
    ? path.resolve(process.env.AXIOMICS_TOOLCHAIN_REGISTRY)
    : path.join(Global.Path.data, "toolchains", "registry.json")
const lock = () => path.join(path.dirname(file()), "registry.lock")
const same = (left: Record<string, string>, right: Record<string, string>) =>
  JSON.stringify(Object.entries(left).toSorted()) === JSON.stringify(Object.entries(right).toSorted())
const sameFiles = (left: z.infer<typeof Attestation>[], right: z.infer<typeof Attestation>[]) =>
  JSON.stringify(left.toSorted((a, b) => a.path.localeCompare(b.path))) ===
  JSON.stringify(right.toSorted((a, b) => a.path.localeCompare(b.path)))
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
const digest = async (target: string) => {
  const bytes = await Bun.file(target).arrayBuffer()
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
}
async function read() {
  const source = Bun.file(file())
  if (!(await source.exists())) return Registry.parse({ version: 1, toolchains: {} })
  return Registry.parse(await source.json())
}
async function executable(target: string) {
  return fs.access(target, process.platform === "win32" ? constants.F_OK : constants.X_OK).then(
    () => true,
    () => false,
  )
}

export namespace ManagedToolchains {
  export type Registration = {
    pack_id: string
    root: string
    lock_digest: string
    entrypoint: string
    attestations: Runtime["attestations"]
    components: Record<string, string>
  }

  /** Infrastructure-only registration. Model-facing tools deliberately do not
   * expose this mutation; deployments provision and attest shared toolchains
   * before research sessions start. */
  export async function register(input: Registration) {
    const root = await fs.realpath(input.root)
    const target = await fs.realpath(path.join(root, input.entrypoint))
    if (!inside(root, target) || !(await executable(target))) {
      throw new Error(`Managed toolchain '${input.pack_id}' entrypoint is unavailable`)
    }
    const attestations = await Promise.all(
      input.attestations.map(async (item) => {
        const target = await fs.realpath(path.join(root, item.path)).catch(() => undefined)
        const info = target ? await fs.stat(target).catch(() => undefined) : undefined
        if (!target || !inside(root, target) || !info?.isFile() || (await digest(target)) !== item.sha256) {
          throw new Error(`Managed toolchain '${input.pack_id}' attestation does not match: ${item.path}`)
        }
        return item
      }),
    )
    const receipt = Receipt.parse({
      version: 1,
      pack_id: input.pack_id,
      root,
      lock_digest: input.lock_digest,
      entrypoint_sha256: await digest(target),
      attestations,
      components: input.components,
      verified_at: new Date().toISOString(),
    })
    await fs.mkdir(path.dirname(file()), { recursive: true })
    await using lease = await FileLease.acquire(lock())
    const current = await read()
    const next = Registry.parse({ ...current, toolchains: { ...current.toolchains, [receipt.pack_id]: receipt } })
    const temporary = `${file()}.${process.pid}.${crypto.randomUUID()}.tmp`
    await Bun.write(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await fs.rename(temporary, file()).catch(async (error) => {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    })
    return receipt
  }

  export async function inspect(runtime: Runtime, options: { verification?: "full" | "status" } = {}) {
    const platform = (() => {
      if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64"
      if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64"
      if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64"
      if (process.platform === "linux" && process.arch === "x64") return "linux-x64"
      if (process.platform === "win32" && process.arch === "x64") return "windows-x64"
      return undefined
    })()
    if (!platform || !runtime.local_platforms.includes(platform)) {
      return { state: "unavailable" as const, platform: platform ?? `${process.platform}-${process.arch}` }
    }
    const receipt = (await read()).toolchains[runtime.pack_id]
    if (!receipt) return { state: "setup_needed" as const, platform }
    if (
      receipt.lock_digest !== runtime.lock_digest ||
      !same(receipt.components, runtime.components) ||
      !sameFiles(receipt.attestations, runtime.attestations)
    ) {
      return { state: "degraded" as const, platform, reason: "registered toolchain does not match its manifest" }
    }
    const root = await fs.realpath(receipt.root).catch(() => undefined)
    const target = root ? await fs.realpath(path.join(root, runtime.entrypoint)).catch(() => undefined) : undefined
    if (!root || !target || !inside(root, target) || !(await executable(target))) {
      return { state: "degraded" as const, platform, reason: "registered entrypoint is unavailable" }
    }
    if (options.verification !== "status" && (await digest(target)) !== receipt.entrypoint_sha256) {
      return { state: "degraded" as const, platform, reason: "registered entrypoint changed after attestation" }
    }
    if (options.verification !== "status") {
      const verified = await Promise.all(
        receipt.attestations.map(async (item) => {
          const target = await fs.realpath(path.join(root, item.path)).catch(() => undefined)
          const info = target ? await fs.stat(target).catch(() => undefined) : undefined
          return Boolean(target && inside(root, target) && info?.isFile() && (await digest(target)) === item.sha256)
        }),
      )
      if (verified.includes(false)) {
        return {
          state: "degraded" as const,
          platform,
          reason: "registered toolchain evidence changed after attestation",
        }
      }
    }
    const paths = runtime.path_entries.map((entry) => path.join(root, entry))
    const env = Object.fromEntries(
      Object.entries(runtime.environment).map(([key, value]) => [key, path.join(root, value)]),
    )
    return {
      state: options.verification === "status" ? ("configured" as const) : ("ready" as const),
      platform,
      root,
      binary: target,
      paths,
      env,
      receipt,
    }
  }

  export async function resolve(runtime: Runtime) {
    const state = await inspect(runtime)
    if (state.state !== "ready") {
      throw new Error(
        `${runtime.pack_id} is ${state.state}. Ask an administrator to provision the shared toolchain; the Agent must not create a replacement environment.`,
      )
    }
    return state
  }
}
