import { afterEach, expect, test } from "bun:test"
import { Axiomics } from "../../src/axiomics"

const prior = { base: process.env.AXIOMICS_API_BASE, auth: process.env.AXIOMICS_AUTH_URL }

function restore(key: "AXIOMICS_API_BASE" | "AXIOMICS_AUTH_URL", value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  restore("AXIOMICS_API_BASE", prior.base)
  restore("AXIOMICS_AUTH_URL", prior.auth)
})

test("the verification page follows the managed base override at call time", () => {
  delete process.env.AXIOMICS_AUTH_URL
  process.env.AXIOMICS_API_BASE = "https://first.example/"
  expect(Axiomics.authPageUrl()).toBe("https://first.example/cli")
  process.env.AXIOMICS_API_BASE = "https://second.example"
  expect(Axiomics.authPageUrl()).toBe("https://second.example/cli")
  process.env.AXIOMICS_AUTH_URL = "https://auth.example/"
  expect(Axiomics.authPageUrl()).toBe("https://auth.example")
})
