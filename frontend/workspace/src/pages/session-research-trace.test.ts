import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const source = readFileSync(fileURLToPath(new URL("./session.tsx", import.meta.url)), "utf8")

test("show-steps expansion survives navigation and reloads", () => {
  expect(source).toContain('const traceExpansionKey = "axiomics-trace-expansion-v1"')
  expect(source).toContain("readTraceExpansion()")
  expect(source).toContain("writeTraceExpansion(next)")
})

test("delegated sessions expose parent and sibling navigation", () => {
  expect(source).toContain('language.t("session.delegated.label")')
  expect(source).toContain('language.t("session.delegated.back")')
  expect(source).toContain('language.t("session.delegated.previous")')
  expect(source).toContain('language.t("session.delegated.next")')
  expect(source).toContain("childSessions().length")
})
