const tools = {
  scanpy: ["scanpy"],
  squidpy: ["squidpy"],
  snapatac2: ["snapatac2"],
  open2c: ["pairtools", "cooler", "cooltools", "open2c"],
  archr: ["archr", "greenleaflab/archr"],
  hicpro: ["hic-pro", "hicpro", "nservant/hic-pro"],
  mcmicro: ["mcmicro", "nf-core/mcmicro"],
} as const

const executable = (value: string) => value.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? ""

export namespace ManagedInstallPolicy {
  export function source(value: string) {
    const source = value.toLowerCase()
    return Object.entries(tools).find(([, aliases]) => aliases.some((alias) => source.includes(alias)))?.[0]
  }

  /** Detect attempts to rebuild a release-managed omics stack through the
   * general shell. Long-tail packages remain available through the normal
   * project overlay path. */
  export function capability(command: readonly string[]) {
    const name = executable(command[0] ?? "")
    const source = command.join(" ").toLowerCase()
    const installer =
      ["pip", "pip3", "conda", "mamba", "micromamba", "uv"].includes(name) ||
      (["python", "python3"].includes(name) && /\s-m\s+pip\s/u.test(source)) ||
      (name === "rscript" && /install(?:_github|\.packages)|biocmanager::install/u.test(source)) ||
      (name === "git" && /\sclone\s/u.test(source))
    if (!installer || !/\b(?:install(?:\b|_)|create\b|clone\b|add\b)/u.test(source)) return undefined
    return ManagedInstallPolicy.source(source)
  }

  /** Keep release-managed runtimes behind scientific_capability even when a
   * model reconstructs the conventional on-disk toolchain path. */
  export function execution(command: readonly string[]) {
    const source = command.join(" ").replaceAll("\\", "/").toLowerCase()
    if (!source.includes("/.axiomics/toolchains/")) return undefined
    return ManagedInstallPolicy.source(source)
  }
}
