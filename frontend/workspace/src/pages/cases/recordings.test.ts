import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// The recordings behind the public replay are served to anonymous visitors.
// They are transcripts of real sessions on the operator's machine, so anything
// that identifies that machine — the data disk, the account that ran the work —
// must be rewritten before it ships. The exporter scrubs it; this guard keeps a
// re-recorded case from reintroducing it. Fixtures are gitignored and only
// exist on a machine that has exported them, so the check skips elsewhere.
const directory = fileURLToPath(new URL("../../../public/cases/replay/", import.meta.url))
const files = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".json")) : []

const leaks = ["/disk1/", "/home/example-user-fc65e6", "dabiao"]
const withRecordings = test.skipIf(files.length === 0)

describe("public recordings", () => {
  withRecordings("parse", () => {
    for (const name of files) {
      expect(() => JSON.parse(readFileSync(directory + name, "utf8"))).not.toThrow()
    }
  })

  withRecordings("carry no operator host paths or account names", () => {
    const found = files.flatMap((name) => {
      const text = readFileSync(directory + name, "utf8")
      return leaks.filter((leak) => text.includes(leak)).map((leak) => `${name}: ${leak}`)
    })

    expect(found).toEqual([])
  })
})
