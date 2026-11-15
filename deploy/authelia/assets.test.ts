import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Artifacts under test: the Authelia login-portal branding for ADR 0002
// (docs/adr/0002-anonymous-workspace-shell.md). The assets are served by
// Authelia's server.asset_path override, so a malformed file here is a
// startup-time failure of the whole login portal, not a cosmetic bug.

const DIR = import.meta.dir
const ASSETS = join(DIR, "assets")
const LOGO = join(ASSETS, "logo.png")
const ICON = join(ASSETS, "favicon.ico")
const APPLY = join(DIR, "apply.sh")

const WORKSPACE = "/disk1/dabiao/project/axiomics/frontend/workspace/public"
const LOGO_SOURCE = join(WORKSPACE, "axiomics-logo.png")
const ICON_SOURCE = join(WORKSPACE, "favicon-v4.ico")

const LIVE_CONFIG = "/disk1/dabiao/axiomics-mt/auth/portless.yml"
const TEMPLATE = "/disk1/dabiao/project/axiomics/tooling/multitenant/auth/portless.yml.tmpl"

// The five keys the ADR names as the branding surface, present in the running
// Authelia v4.39.28 /locales/en/portal.json. Frozen here so a silent upstream
// rename fails the suite instead of leaving an untranslated login page.
const REQUIRED = ["Login - {{authelia}}", "Sign in", "Username", "Password", "Powered by {{authelia}}"]

// Authelia refuses to start when a key containing {{authelia}} has a value
// without it. That is the failure the ADR's suggested copy would have caused.
const PLACEHOLDER_KEYS = ["Login - {{authelia}}", "Powered by {{authelia}}"]

const LOCALES = ["en", "zh-CN"]
const CJK = /[一-鿿]/

const path = (lang: string) => join(ASSETS, "locales", lang, "portal.json")
const bytes = (file: string) => readFileSync(file)
const locale = (lang: string) => JSON.parse(readFileSync(path(lang), "utf-8")) as Record<string, string>
const tokens = (text: string) => text.match(/\{\{\w+\}\}/g) ?? []

const shims: string[] = []
afterAll(() => {
  for (const dir of shims) rmSync(dir, { recursive: true, force: true })
})

// Runs apply.sh with podman/curl/install/cp/chmod shimmed to a marker file.
// Nothing in the plan may reach these, so a marker means the "dry run" wrote
// something. The shims also keep a buggy script from touching the live volume.
function dryRun(args: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "ax-authelia-apply-"))
  shims.push(dir)
  const marker = join(dir, "invoked")
  for (const name of ["podman", "curl", "install", "cp", "chmod", "mv"]) {
    writeFileSync(join(dir, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> '${marker}'\nexit 0\n`, {
      mode: 0o755,
    })
  }
  const proc = Bun.spawnSync(["bash", APPLY, ...args], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
  })
  return {
    marker,
    code: proc.exitCode,
    out: proc.stdout.toString(),
    err: proc.stderr.toString(),
  }
}

describe("branding images", () => {
  test("logo.png is a real PNG and is large enough for the 64px logo slot", () => {
    const buf = bytes(LOGO)
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
    expect(buf.subarray(12, 16).toString("latin1")).toBe("IHDR")
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    expect(width).toBeGreaterThanOrEqual(64)
    expect(height).toBeGreaterThanOrEqual(64)
    expect(width).toBe(height)
    expect(buf.length).toBeGreaterThan(1024)
  })

  test("favicon.ico is a multi-size ICO whose entries fit the file", () => {
    const buf = bytes(ICON)
    expect(buf.subarray(0, 4).toString("hex")).toBe("00000100")
    const count = buf.readUInt16LE(4)
    expect(count).toBeGreaterThan(0)
    const sizes = Array.from({ length: count }, (_, index) => {
      const entry = 6 + index * 16
      const size = buf.readUInt32LE(entry + 8)
      const offset = buf.readUInt32LE(entry + 12)
      expect(offset + size).toBeLessThanOrEqual(buf.length)
      return buf[entry] === 0 ? 256 : buf[entry]
    })
    expect(sizes).toContain(32)
    expect(sizes).toContain(16)
  })

  test.skipIf(!existsSync(LOGO_SOURCE) || !existsSync(ICON_SOURCE))(
    "the checked-in copies are byte-identical to the workspace sources",
    () => {
      expect(bytes(LOGO).equals(bytes(LOGO_SOURCE))).toBe(true)
      expect(bytes(ICON).equals(bytes(ICON_SOURCE))).toBe(true)
    },
  )
})

describe("portal locales", () => {
  for (const lang of LOCALES) {
    test(`${lang}/portal.json parses and holds only non-empty strings`, () => {
      const data = locale(lang)
      expect(Object.keys(data).length).toBeGreaterThan(50)
      const broken = Object.entries(data).filter(([, value]) => typeof value !== "string" || value.trim() === "")
      expect(broken).toEqual([])
    })

    test(`${lang}/portal.json carries every login key the ADR names`, () => {
      const data = locale(lang)
      expect(REQUIRED.filter((key) => !(key in data))).toEqual([])
    })

    test(`${lang}/portal.json keeps every {{placeholder}} of its key`, () => {
      const data = locale(lang)
      const dropped = Object.entries(data)
        .filter(([key, value]) => {
          const wanted = tokens(key)
          return wanted.some((token) => !value.includes(token))
        })
        .map(([key]) => key)
      expect(dropped).toEqual([])
    })
  }

  test("en and zh-CN cover the same key set so no string falls back to a raw key", () => {
    const en = locale("en")
    const zh = locale("zh-CN")
    expect(Object.keys(zh).filter((key) => !(key in en))).toEqual([])
    expect(Object.keys(en).filter((key) => !(key in zh))).toEqual([])
  })

  test("zh-CN login copy is Chinese and says Axiomics", () => {
    const zh = locale("zh-CN")
    for (const key of ["Login - {{authelia}}", "Sign in", "Username", "Password"]) {
      expect(zh[key], key).toMatch(CJK)
    }
    expect(zh["Sign in"]).toContain("Axiomics")
    expect(zh["Powered by {{authelia}}"]).toContain("多组学")
    expect(zh["Username"]).not.toContain("Authelia")
  })

  test("the ADR's literal values (which drop {{authelia}}) are not what shipped", () => {
    const zh = locale("zh-CN")
    for (const key of PLACEHOLDER_KEYS) expect(zh[key], key).toContain("{{authelia}}")
    // "登录 - Axiomics" and "Axiomics 多组学分析平台" would abort startup with:
    // translation key ... has a value which is missing a required placeholder
    expect(zh["Login - {{authelia}}"]).not.toBe("登录 - Axiomics")
    expect(zh["Powered by {{authelia}}"]).not.toBe("Axiomics 多组学分析平台")
  })

  // Opt-in: AUTHELIA_LOCALES_URL=http://127.0.0.1:9091 asserts parity with the
  // build actually running, instead of only with this file's snapshot.
  const upstream = Bun.env.AUTHELIA_LOCALES_URL
  test.skipIf(!upstream)("key set matches the running Authelia build", async () => {
    const res = await fetch(`${upstream}/locales/en/portal.json`)
    expect(res.ok, `${upstream} returned ${res.status}`).toBe(true)
    const theirs = (await res.json()) as Record<string, string>
    const ours = locale("en")
    expect(Object.keys(theirs).filter((key) => !(key in ours))).toEqual([])
    expect(Object.keys(ours).filter((key) => !(key in theirs))).toEqual([])
  })
})

describe("apply.sh", () => {
  test("is valid bash", () => {
    const proc = Bun.spawnSync(["bash", "-n", APPLY])
    expect(proc.exitCode, proc.stderr.toString()).toBe(0)
  })

  test("never invokes podman, curl or a shell pipeline", () => {
    const offenders = readFileSync(APPLY, "utf-8")
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => line !== "" && !line.startsWith("#"))
      .filter(
        ({ line }) =>
          /^(podman|curl|docker|systemctl|eval|exec)\b/.test(line) ||
          /\|\s*(sh|bash)\b/.test(line) ||
          /\$\((podman|curl)\b/.test(line) ||
          /`(podman|curl)\b/.test(line),
      )
      .map(({ line, number }) => `${number}: ${line}`)
    expect(offenders).toEqual([])
  })

  test("dry run prints the apply commands and executes none of them", () => {
    const run = dryRun()
    expect(run.err).toBe("")
    expect(run.code).toBe(0)
    expect(run.out).toContain("podman cp")
    expect(run.out).toContain(LOGO)
    expect(run.out).toContain("asset_path: /config/assets")
    expect(run.out).toContain("podman restart ax-authelia")
    expect(run.out).toContain("validate-config --config /config/portless.yml")
    expect(run.out).toContain(LIVE_CONFIG)
    expect(run.out).toContain(TEMPLATE)
    expect(existsSync(run.marker)).toBe(false)
  })

  test("--run is refused instead of applied", () => {
    const run = dryRun(["--run"])
    expect(run.code).not.toBe(0)
    expect(`${run.out}${run.err}`).toMatch(/refus/i)
    expect(existsSync(run.marker)).toBe(false)
  })

  test.skipIf(!existsSync(LIVE_CONFIG))("dry run leaves the live config byte-identical", () => {
    const before = bytes(LIVE_CONFIG)
    const run = dryRun()
    expect(run.code).toBe(0)
    expect(bytes(LIVE_CONFIG).equals(before)).toBe(true)
  })

  test.skipIf(!existsSync(LIVE_CONFIG))("dry run output leaks no Authelia secrets", () => {
    const config = readFileSync(LIVE_CONFIG, "utf-8")
    const secrets = [...config.matchAll(/^\s*(?:jwt_secret|encryption_key|secret):\s*(\S+)\s*$/gm)].map((m) => m[1])
    expect(secrets.length).toBeGreaterThan(0)
    const run = dryRun()
    expect(secrets.filter((secret) => run.out.includes(secret))).toEqual([])
  })
})
