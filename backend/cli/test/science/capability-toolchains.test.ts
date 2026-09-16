import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CapabilityRegistry } from "../../src/science/capability/registry"
import { ManagedToolchains } from "../../src/science/capability/toolchains"
import { ScientificCapabilityTool } from "../../src/tool/scientific-capability"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "axiomics-toolchain-"))
const registry = path.join(root, "registry.json")
const runtime = CapabilityRegistry.describe("scanpy")?.runtime

describe("managed scientific toolchains", () => {
  beforeAll(async () => {
    if (runtime?.kind !== "managed_toolchain") throw new Error("Scanpy managed toolchain is missing")
    process.env.AXIOMICS_TOOLCHAIN_REGISTRY = registry
    await fs.mkdir(path.join(root, "bin"), { recursive: true })
    await Bun.write(path.join(root, "bin", "python"), '#!/bin/sh\nexec /usr/bin/env python3 "$@"\n', { mode: 0o755 })
    await fs.chmod(path.join(root, "bin", "python"), 0o755)
    await fs.copyFile(
      path.join(import.meta.dir, "../../src/science/capability/locks/scanpy-requirements.txt"),
      path.join(root, runtime.attestations[0]!.path),
    )
  })

  afterAll(async () => {
    delete process.env.AXIOMICS_TOOLCHAIN_REGISTRY
    await fs.rm(root, { recursive: true, force: true })
  })

  test("keeps unregistered runtimes unavailable instead of rebuilding them", async () => {
    if (runtime?.kind !== "managed_toolchain") throw new Error("Scanpy managed toolchain is missing")
    expect(await ManagedToolchains.inspect(runtime)).toMatchObject({ state: "setup_needed", platform: "linux-x64" })
  })

  test("fails closed when the infrastructure registry is corrupt", async () => {
    if (runtime?.kind !== "managed_toolchain") throw new Error("Scanpy managed toolchain is missing")
    await Bun.write(registry, "not-json\n")
    expect(ManagedToolchains.inspect(runtime)).rejects.toThrow()
    await fs.rm(registry)
  })

  test("registers once and injects the runtime outside the model command", async () => {
    if (runtime?.kind !== "managed_toolchain") throw new Error("Scanpy managed toolchain is missing")
    await ManagedToolchains.register({
      pack_id: runtime.pack_id,
      root,
      lock_digest: runtime.lock_digest,
      entrypoint: runtime.entrypoint,
      attestations: runtime.attestations,
      components: runtime.components,
    })
    const result = await CapabilityRegistry.compileTask("scanpy", {
      name: "PBMC analysis",
      purpose: "Analyze a public single-cell dataset",
      command: "python analysis.py",
      target: "local",
    })
    expect(result.input.command).toBe("python analysis.py")
    expect(result.input.uploads).toBeUndefined()
    expect(result.execution.runtime_root).toBe(root)
    expect(result.execution.runtime_path).toEqual([path.join(root, "bin")])
    expect(result.execution.runtime_env).toEqual({ CONDA_PREFIX: root })
    expect(result.execution.software_manifest).toContain('"scanpy":"1.11.4"')

    const asked: unknown[] = []
    const tool = await ScientificCapabilityTool.init()
    const setup = await tool.execute(
      { action: "setup", id: "scanpy" },
      {
        sessionID: "ses_toolchain_setup",
        messageID: "msg_toolchain_setup",
        callID: "call_toolchain_setup",
        agent: "research",
        abort: new AbortController().signal,
        messages: [],
        metadata() {},
        async ask(input) {
          asked.push(input)
        },
      },
    )
    expect(JSON.parse(setup.output)).toMatchObject({ capability: "scanpy", state: "ready" })
    expect(JSON.parse(setup.output)).not.toHaveProperty("path")
    expect(setup.metadata.scientific_capability.dispatched).toBe(false)
    expect(asked).toEqual([])
  })

  test.each(["stamo", "camus", "stamapper", "scvi"])(
    "binds %s without changing CPU jobs or model commands",
    async (id) => {
      const manifest = CapabilityRegistry.describe(id)!
      const runtime = manifest.runtime
      if (runtime?.kind !== "managed_toolchain") throw new Error("STAMO managed toolchain is missing")
      await fs.copyFile(
        path.join(import.meta.dir, `../../src/science/capability/locks/${id}-requirements.txt`),
        path.join(root, runtime.attestations[0]!.path),
      )
      for (const item of runtime.attestations.slice(1)) {
        await fs.copyFile(
          path.join(import.meta.dir, "../../../../tooling/acceptance-cases/cases/camus-merfish/patches", item.path),
          path.join(root, item.path),
        )
      }
      await ManagedToolchains.register({ ...runtime, root })
      const result = await CapabilityRegistry.compileTask(id, {
        name: "Spatial integration",
        purpose: "Integrate measured RNA and histone modification",
        command: "python analysis.py",
        target: "local",
      })
      expect(result.input.command).toBe("python analysis.py")
      expect(result.input.resources?.gpus).toBe(1)
      expect(result.execution.runtime_env).toEqual(id === "stamo" ? {} : { LD_LIBRARY_PATH: path.join(root, "lib") })
      expect(result.execution.runtime_path).toEqual([path.join(root, "bin")])
      const cpu = await CapabilityRegistry.compileTask("scanpy", {
        name: "RNA",
        purpose: "Analyze counts",
        command: "python qc.py",
        target: "local",
      })
      expect(cpu.input.resources?.gpus).toBe(0)
      expect(
        CapabilityRegistry.compileTask(id, {
          name: "Remote",
          purpose: "Not supported",
          command: "python analysis.py",
          target: "modal",
        }),
      ).rejects.toThrow("supports local")
    },
  )

  test("fails closed when an attested entrypoint changes", async () => {
    if (runtime?.kind !== "managed_toolchain") throw new Error("Scanpy managed toolchain is missing")
    const evidence = path.join(root, runtime.attestations[0]!.path)
    await Bun.write(evidence, "tampered\n")
    expect(await ManagedToolchains.inspect(runtime)).toMatchObject({
      state: "degraded",
      reason: "registered toolchain evidence changed after attestation",
    })
    await fs.copyFile(
      path.join(import.meta.dir, "../../src/science/capability/locks/scanpy-requirements.txt"),
      evidence,
    )
    await Bun.write(path.join(root, "bin", "python"), "#!/bin/sh\nexit 9\n", { mode: 0o755 })
    await fs.chmod(path.join(root, "bin", "python"), 0o755)
    expect(await ManagedToolchains.inspect(runtime)).toMatchObject({
      state: "degraded",
      reason: "registered entrypoint changed after attestation",
    })
  })
})
