import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { Axiomics } from "../src/axiomics"
import { ToolOutputPath } from "../src/tool/tool-output-path"

test("structured credentials are redacted before registered secret substrings", () => {
  const suffix = createHash("sha256").update("axiomics-redaction-suffix").digest("hex")
  const prefix = createHash("sha256").update("axiomics-redaction-prefix").digest("hex").slice(0, 10)
  const epoch = createHash("sha256").update("axiomics-redaction-epoch").digest("hex").slice(0, 32)
  const nonce = createHash("sha256").update("axiomics-redaction-nonce").digest("hex").slice(0, 32)
  const proof = `odp_v2.${prefix}.${epoch}.${nonce}.${suffix}`
  Axiomics.registerSecretValues([suffix])

  expect(Axiomics.redactSecrets(`before x${proof}x after`)).toBe("before x[REDACTED]x after")
})

test("subprocess env filtering never passes managed Atlas provider keys", () => {
  const filtered = Axiomics.filterEnvForSubprocess({
    PATH: "/usr/bin",
    OPENROUTER_API_KEY: "thk_managed_openrouter",
    OPENAI_API_KEY: "thk_managed_openai",
    OPENROUTER_BASE_URL: "https://atlas.test/api/llm/proxy/openrouter/v1",
    META_MODEL_API_KEY: "thk_managed_meta",
    META_MODEL_BASE_URL: "https://atlas.test/api/llm/proxy/meta/v1",
    XAI_API_KEY: "xai-user-owned",
  })

  expect(filtered.PATH).toBe("/usr/bin")
  expect(filtered.OPENROUTER_API_KEY).toBeUndefined()
  expect(filtered.OPENAI_API_KEY).toBeUndefined()
  expect(filtered.META_MODEL_API_KEY).toBeUndefined()
  expect(filtered.XAI_API_KEY).toBe("xai-user-owned")
  expect(filtered.OPENROUTER_BASE_URL).toBeUndefined()
  expect(filtered.META_MODEL_BASE_URL).toBeUndefined()
})

test("subprocess env filtering still passes BYOK OpenRouter keys", () => {
  const filtered = Axiomics.filterEnvForSubprocess({
    OPENROUTER_API_KEY: "sk-or-user-owned",
  })

  expect(filtered.OPENROUTER_API_KEY).toBe("sk-or-user-owned")
})

test("subprocess env filtering preserves writable TeX cache roots", () => {
  const filtered = Axiomics.filterEnvForSubprocess({
    TEXMFCONFIG: "/workspace/.axiomics/cache/texlive/config",
    TEXMFVAR: "/workspace/.axiomics/cache/texlive/var",
  })

  expect(filtered.TEXMFCONFIG).toBe("/workspace/.axiomics/cache/texlive/config")
  expect(filtered.TEXMFVAR).toBe("/workspace/.axiomics/cache/texlive/var")
})

test("subprocess env filtering repins BYOK away from an inherited Atlas proxy", () => {
  const filtered = Axiomics.filterEnvForSubprocess({
    OPENROUTER_API_KEY: "sk-or-user-owned",
    OPENROUTER_BASE_URL: "https://atlas.test/api/llm/proxy/openrouter/v1",
  })

  expect(filtered.OPENROUTER_API_KEY).toBe("sk-or-user-owned")
  expect(filtered.OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1")
})

test("subprocess env filtering preserves a BYOK custom gateway", () => {
  const filtered = Axiomics.filterEnvForSubprocess({
    OPENROUTER_API_KEY: "sk-or-user-owned",
    OPENROUTER_BASE_URL: "https://my-gateway.example/api/v1",
  })

  expect(filtered.OPENROUTER_BASE_URL).toBe("https://my-gateway.example/api/v1")
})

test("subprocess env filtering never exposes compute or desktop control-plane capabilities", () => {
  const filtered = Axiomics.filterEnvForSubprocess({
    PATH: "/usr/bin",
    MODAL_TOKEN_ID: "ak-user-owned",
    MODAL_TOKEN_SECRET: "as-user-owned",
    AXIOMICS_DESKTOP_UPDATE_URL: "http://127.0.0.1:4096/settings/updates/apply",
    AXIOMICS_DESKTOP_UPDATE_TOKEN: "desktop-update-capability",
    LAMBDA_API_KEY: "lambda-user-owned",
    RUNPOD_API_KEY: "runpod-user-owned",
  })

  expect(filtered).toEqual({ PATH: "/usr/bin" })
})

test("control-plane filtering denies the complete desktop update namespace after environment overlays", () => {
  const filtered = Axiomics.filterControlPlaneEnv({
    PATH: "/usr/bin",
    AXIOMICS_DESKTOP_UPDATE_URL: "http://127.0.0.1:4096/settings/updates/apply",
    AXIOMICS_DESKTOP_UPDATE_TOKEN: "desktop-update-capability",
    AXIOMICS_DESKTOP_UPDATE_FUTURE_CAPABILITY: "must-default-deny",
    PROJECT_AUTHORED_VALUE: "preserved",
  })

  expect(filtered).toEqual({
    PATH: "/usr/bin",
    PROJECT_AUTHORED_VALUE: "preserved",
  })
})

test("representative agent subprocess environments cannot inherit host control-plane capabilities", () => {
  const ambient = {
    PATH: "/usr/bin",
    HOME: "/home/example-user-3588bb",
    TENSORPOOL_KEY: "tensorpool-host-capability",
    LAMBDA_API_KEY: "lambda-host-capability",
    PRIME_API_KEY: "prime-host-capability",
    VAST_API_KEY: "vast-host-capability",
    RUNPOD_API_KEY: "runpod-host-capability",
    AXIOMICS_DESKTOP_UPDATE_URL: "http://127.0.0.1:4096/settings/updates/apply",
    AXIOMICS_DESKTOP_UPDATE_TOKEN: "desktop-update-capability",
  }
  const sanitized = Axiomics.filterEnvForSubprocess(ambient)
  const environments: Record<string, Record<string, string>> = {
    bashAfterRuntimeOverlay: Axiomics.filterEnvForSubprocess({
      ...sanitized,
      AXIOMICS_DESKTOP_UPDATE_TOKEN: "restored-by-runtime-overlay",
    }),
    taskShell: { ...sanitized, TERM: "dumb" },
    localCompute: sanitized,
    kernel: Axiomics.kernelEnv(ambient, {
      AXIOMICS_DESKTOP_UPDATE_URL: "restored-by-kernel-overlay",
      AXIOMICS_DESKTOP_UPDATE_TOKEN: "restored-by-kernel-overlay",
    }),
  }

  for (const environment of Object.values(environments)) {
    expect(environment.TENSORPOOL_KEY).toBeUndefined()
    expect(environment.LAMBDA_API_KEY).toBeUndefined()
    expect(environment.PRIME_API_KEY).toBeUndefined()
    expect(environment.VAST_API_KEY).toBeUndefined()
    expect(environment.RUNPOD_API_KEY).toBeUndefined()
    expect(environment.AXIOMICS_DESKTOP_UPDATE_URL).toBeUndefined()
    expect(environment.AXIOMICS_DESKTOP_UPDATE_TOKEN).toBeUndefined()
  }
})

test("kernel env filtering keeps runtime configuration but drops credentials", () => {
  const filtered = Axiomics.filterEnvForKernel({
    PATH: "/usr/bin",
    HOME: "/home/example-user-3588bb",
    LANG: "en_US.UTF-8",
    VIRTUAL_ENV: "/work/.venv",
    PYTHONPATH: "/work/python",
    R_LIBS: "/work/R",
    PIP_TARGET: "/work/python/site-packages",
    PIP_INDEX_URL: "https://mirror.example/simple",
    PIP_TRUSTED_HOST: "mirror.example",
    R_PROFILE_USER: "/work/Rprofile",
    ATLAS_API_KEY: "thk_atlas",
    OPENROUTER_API_KEY: "sk-or-user-owned",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    PRIVATE_RESEARCH_TOKEN: "private-secret",
  })

  expect(filtered).toEqual({
    PATH: "/usr/bin",
    HOME: "/home/example-user-3588bb",
    LANG: "en_US.UTF-8",
    VIRTUAL_ENV: "/work/.venv",
    PYTHONPATH: "/work/python",
    R_LIBS: "/work/R",
    PIP_TARGET: "/work/python/site-packages",
    PIP_INDEX_URL: "https://mirror.example/simple",
    PIP_TRUSTED_HOST: "mirror.example",
    R_PROFILE_USER: "/work/Rprofile",
  })
})

test("kernel subprocesses cannot fall back to host Git config or credential prompts", () => {
  const env = Axiomics.kernelEnv({ PATH: "/usr/bin", HOME: "/home/example-user-3588bb" })
  expect(env.GIT_CONFIG_NOSYSTEM).toBe("1")
  expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null")
  expect(env.GIT_TERMINAL_PROMPT).toBe("0")
})

test("deployment trust-store settings reach interpreters but nothing else follows", () => {
  // Bundled conda environments ship their own certifi copy. A deployment that
  // installed an internal CA points these at the system bundle; dropping them
  // would leave sandboxed Python unable to reach the same internal endpoints
  // the shell can, while the host-side filters still reject credentials.
  const trust = {
    SSL_CERT_FILE: "/etc/pki/tls/certs/ca-bundle.crt",
    SSL_CERT_DIR: "/etc/pki/tls/certs",
    REQUESTS_CA_BUNDLE: "/etc/pki/tls/certs/ca-bundle.crt",
    CURL_CA_BUNDLE: "/etc/pki/tls/certs/ca-bundle.crt",
    PIP_CERT: "/etc/pki/tls/certs/ca-bundle.crt",
    GIT_SSL_CAINFO: "/etc/pki/tls/certs/ca-bundle.crt",
    NODE_EXTRA_CA_CERTS: "/etc/pki/ca-trust/source/anchors/axiomics-internal-ca.crt",
  }
  for (const filter of [Axiomics.filterEnvForSubprocess, Axiomics.filterEnvForKernel]) {
    const filtered = filter({ PATH: "/usr/bin", ...trust, AWS_SECRET_ACCESS_KEY: "aws-secret" })
    expect(filtered).toMatchObject(trust)
    expect(filtered.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  }
})

test("kernel credential mask covers current Axiomics credential stores", () => {
  const paths = Axiomics.kernelSensitivePaths()
  const names = paths.map((value) => path.basename(value))
  expect(names).toContain("axiomics-session.json")
  expect(names).toContain("axiomics-workspace-scope.json")
  expect(names).toContain("auth.json")
  expect(names).toContain("credentials.json")
  expect(names).toContain("mcp-auth.json")
  expect(paths).toContain(ToolOutputPath.root)
  expect(names).toContain(".ssh")
  expect(names).toContain(".aws")
  expect(names).toContain(".netrc")
  expect(names).toContain(".git-credentials")
  expect(paths).toContain(
    process.env.ATLAS_CLI_CONFIG_PATH || path.join(os.homedir(), ".config", "atlas-cli", "config.json"),
  )
})

test("mergeByokEnv injects a locally-connected OpenRouter key + pins public base url", () => {
  const merged = Axiomics.mergeByokEnv(
    { PATH: "/usr/bin", OPENROUTER_BASE_URL: "https://atlas.test/api/llm/proxy/openrouter/v1" },
    { openrouter: { type: "api", key: "sk-or-user-owned" } },
  )

  expect(merged.OPENROUTER_API_KEY).toBe("sk-or-user-owned")
  // A bridged BYOK key must hit public OpenRouter, not the managed proxy.
  expect(merged.OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1")
})

test("mergeByokEnv never injects a managed thk_ key", () => {
  const merged = Axiomics.mergeByokEnv({}, { openrouter: { type: "api", key: "thk_managed" } })
  expect(merged.OPENROUTER_API_KEY).toBeUndefined()
})

test("mergeByokEnv does not override an existing value", () => {
  const merged = Axiomics.mergeByokEnv(
    { OPENROUTER_API_KEY: "sk-or-from-shell" },
    { openrouter: { type: "api", key: "sk-or-from-auth" } },
  )
  expect(merged.OPENROUTER_API_KEY).toBe("sk-or-from-shell")
})

test("mergeByokEnv repairs an existing BYOK key paired with the managed proxy", () => {
  const merged = Axiomics.mergeByokEnv(
    {
      OPENROUTER_API_KEY: "sk-or-from-shell",
      OPENROUTER_BASE_URL: "https://app.axiomics.ai/api/llm/proxy/openrouter/v1",
    },
    {},
  )

  expect(merged.OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1")
})

test("mergeByokEnv supports the canonical direct-provider set and aliases", () => {
  const merged = Axiomics.mergeByokEnv(
    {},
    {
      anthropic: { type: "api", key: "sk-ant-user" },
      google: { type: "api", key: "google-user" },
      togetherai: { type: "api", key: "together-user" },
      "fireworks-ai": { type: "api", key: "fireworks-user" },
      deepseek: { type: "api", key: "deepseek-user" },
      perplexity: { type: "api", key: "perplexity-user" },
    },
  )

  expect(merged.ANTHROPIC_API_KEY).toBe("sk-ant-user")
  expect(merged.GOOGLE_GENERATIVE_AI_API_KEY).toBe("google-user")
  expect(merged.GOOGLE_API_KEY).toBe("google-user")
  expect(merged.GEMINI_API_KEY).toBe("google-user")
  expect(merged.TOGETHER_API_KEY).toBe("together-user")
  expect(merged.FIREWORKS_API_KEY).toBe("fireworks-user")
  expect(merged.DEEPSEEK_API_KEY).toBe("deepseek-user")
  expect(merged.PERPLEXITY_API_KEY).toBe("perplexity-user")
})
