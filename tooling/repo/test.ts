#!/usr/bin/env bun

/**
 * Run `bun test` with every outbound-proxy variable removed.
 *
 * Local HTTP fixtures bind 127.0.0.1, and a developer or CI host with
 * HTTP_PROXY set would otherwise route those requests through its own proxy —
 * the fixture never answers, and the suite fails with the proxy's status
 * (observed as HTTP 503) rather than anything the test asserted.
 *
 * This has to happen in the parent. Bun resolves its fetch proxy configuration
 * from the environment once, at process start, so deleting the variables from a
 * test preload runs too late to change it — verified: a preload that deletes all
 * eight still proxies. The suite never needs an outbound proxy, so clearing them
 * here is both the fix and the intent.
 *
 * Usage: the test scripts route through this file, so `bun run test` behaves the
 * same whether or not the caller's shell has a proxy configured.
 */
const PROXY = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
]

const env = { ...process.env }
for (const key of PROXY) delete env[key]

const proc = Bun.spawn(["bun", "test", ...Bun.argv.slice(2)], {
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
process.exit(await proc.exited)
