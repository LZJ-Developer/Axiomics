function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function csv(key: string) {
  return new Set(
    (process.env[key] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )
}

export namespace Flag {
  export const AXIOMICS_AUTO_SHARE = truthy("AXIOMICS_AUTO_SHARE")
  export const AXIOMICS_GIT_BASH_PATH = process.env["AXIOMICS_GIT_BASH_PATH"]
  export const AXIOMICS_CONFIG = process.env["AXIOMICS_CONFIG"]
  export declare const AXIOMICS_CONFIG_DIR: string | undefined
  export const AXIOMICS_CONFIG_CONTENT = process.env["AXIOMICS_CONFIG_CONTENT"]
  export const AXIOMICS_DISABLE_AUTOUPDATE = truthy("AXIOMICS_DISABLE_AUTOUPDATE")
  export const AXIOMICS_DISABLE_PRUNE = truthy("AXIOMICS_DISABLE_PRUNE")
  export const AXIOMICS_DISABLE_TERMINAL_TITLE = truthy("AXIOMICS_DISABLE_TERMINAL_TITLE")
  /** Deployment policy for products used through the web UI only: no shell
   * surface at all, so the PTY routes refuse and the client hides its entries.
   * Unset keeps today's behaviour. */
  export const AXIOMICS_DISABLE_TERMINAL = truthy("AXIOMICS_DISABLE_TERMINAL")
  export const AXIOMICS_PERMISSION = process.env["AXIOMICS_PERMISSION"]
  export const AXIOMICS_DISABLE_DEFAULT_PLUGINS = truthy("AXIOMICS_DISABLE_DEFAULT_PLUGINS")
  export const AXIOMICS_DISABLE_LSP_DOWNLOAD = truthy("AXIOMICS_DISABLE_LSP_DOWNLOAD")
  export const AXIOMICS_ENABLE_EXPERIMENTAL_MODELS = truthy("AXIOMICS_ENABLE_EXPERIMENTAL_MODELS")
  export const AXIOMICS_DISABLE_AUTOCOMPACT = truthy("AXIOMICS_DISABLE_AUTOCOMPACT")
  export const AXIOMICS_DISABLE_MODELS_FETCH = truthy("AXIOMICS_DISABLE_MODELS_FETCH")
  export const AXIOMICS_DISABLE_CLAUDE_CODE = truthy("AXIOMICS_DISABLE_CLAUDE_CODE")
  export const AXIOMICS_DISABLE_CLAUDE_CODE_PROMPT =
    AXIOMICS_DISABLE_CLAUDE_CODE || truthy("AXIOMICS_DISABLE_CLAUDE_CODE_PROMPT")
  export const AXIOMICS_DISABLE_CLAUDE_CODE_SKILLS =
    AXIOMICS_DISABLE_CLAUDE_CODE || truthy("AXIOMICS_DISABLE_CLAUDE_CODE_SKILLS")
  export const AXIOMICS_DISABLE_BUNDLED_SKILLS = truthy("AXIOMICS_DISABLE_BUNDLED_SKILLS")
  export declare const AXIOMICS_DISABLED_SKILLS: ReadonlySet<string>
  export declare const AXIOMICS_DISABLE_PROJECT_CONFIG: boolean
  export const AXIOMICS_FAKE_VCS = process.env["AXIOMICS_FAKE_VCS"]
  export const AXIOMICS_CLIENT = process.env["AXIOMICS_CLIENT"] ?? "cli"
  export const AXIOMICS_TRUST_PROXY = truthy("AXIOMICS_TRUST_PROXY")
  export declare const AXIOMICS_ENABLE_RESEARCH_AGENT_TEST: boolean

  // Experimental
  export const AXIOMICS_EXPERIMENTAL = truthy("AXIOMICS_EXPERIMENTAL")
  export const AXIOMICS_EXPERIMENTAL_FILEWATCHER = truthy("AXIOMICS_EXPERIMENTAL_FILEWATCHER")
  export const AXIOMICS_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("AXIOMICS_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const AXIOMICS_EXPERIMENTAL_ICON_DISCOVERY =
    AXIOMICS_EXPERIMENTAL || truthy("AXIOMICS_EXPERIMENTAL_ICON_DISCOVERY")
  export const AXIOMICS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("AXIOMICS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const AXIOMICS_ENABLE_EXA =
    truthy("AXIOMICS_ENABLE_EXA") || AXIOMICS_EXPERIMENTAL || truthy("AXIOMICS_EXPERIMENTAL_EXA")
  export const AXIOMICS_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("AXIOMICS_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const AXIOMICS_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("AXIOMICS_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const AXIOMICS_EXPERIMENTAL_OXFMT = AXIOMICS_EXPERIMENTAL || truthy("AXIOMICS_EXPERIMENTAL_OXFMT")
  export const AXIOMICS_EXPERIMENTAL_LSP_TY = truthy("AXIOMICS_EXPERIMENTAL_LSP_TY")
  export const AXIOMICS_EXPERIMENTAL_LSP_TOOL = AXIOMICS_EXPERIMENTAL || truthy("AXIOMICS_EXPERIMENTAL_LSP_TOOL")
  export const AXIOMICS_DISABLE_FILETIME_CHECK = truthy("AXIOMICS_DISABLE_FILETIME_CHECK")
  export const AXIOMICS_EXPERIMENTAL_PLAN_MODE = AXIOMICS_EXPERIMENTAL || truthy("AXIOMICS_EXPERIMENTAL_PLAN_MODE")
  export const AXIOMICS_EXPERIMENTAL_MARKDOWN = truthy("AXIOMICS_EXPERIMENTAL_MARKDOWN")
  export const AXIOMICS_MODELS_URL = process.env["AXIOMICS_MODELS_URL"]

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for AXIOMICS_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "AXIOMICS_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("AXIOMICS_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for AXIOMICS_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "AXIOMICS_CONFIG_DIR", {
  get() {
    return process.env["AXIOMICS_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Keep the lab profile opt-in at access time. Tests and the dev-lab launcher
// intentionally set this after modules have loaded, while release processes
// leave it absent so the production agent catalog is unchanged.
Object.defineProperty(Flag, "AXIOMICS_ENABLE_RESEARCH_AGENT_TEST", {
  get() {
    return truthy("AXIOMICS_ENABLE_RESEARCH_AGENT_TEST")
  },
  enumerable: true,
  configurable: false,
})

// Read this operator policy at access time so long-running servers can refresh
// their skill catalog after an environment/configuration reload.
Object.defineProperty(Flag, "AXIOMICS_DISABLED_SKILLS", {
  get() {
    return csv("AXIOMICS_DISABLED_SKILLS")
  },
  enumerable: true,
  configurable: false,
})
