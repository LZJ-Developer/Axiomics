import { EOL } from "node:os"
import { CapabilityRegistry } from "@/science/capability/registry"
import { ManagedToolchains } from "@/science/capability/toolchains"
import { cmd } from "../cmd"

export const ToolchainRegisterCommand = cmd({
  command: "toolchain-register <id> <root>",
  describe: "register an administrator-provisioned scientific toolchain",
  builder: (yargs) =>
    yargs
      .positional("id", { type: "string", demandOption: true, description: "Scientific capability id" })
      .positional("root", { type: "string", demandOption: true, description: "Absolute immutable toolchain root" }),
  async handler(args) {
    const manifest = CapabilityRegistry.describe(String(args.id))
    if (!manifest) throw new Error(`Unknown scientific capability: ${String(args.id)}`)
    if (manifest.runtime?.kind !== "managed_toolchain") {
      throw new Error(`${manifest.name} is not an administrator-provisioned toolchain`)
    }
    const receipt = await ManagedToolchains.register({
      pack_id: manifest.runtime.pack_id,
      root: String(args.root),
      lock_digest: manifest.runtime.lock_digest,
      entrypoint: manifest.runtime.entrypoint,
      attestations: manifest.runtime.attestations,
      components: manifest.runtime.components,
    })
    process.stdout.write(JSON.stringify({ capability: manifest.id, receipt }, null, 2) + EOL)
  },
})
