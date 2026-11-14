import { afterEach, expect, test } from "bun:test"
import { submitLogin } from "./login"

const realFetch = globalThis.fetch

function answer(status: number, init: { redirected?: boolean } = {}) {
  globalThis.fetch = (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      redirected: init.redirected ?? false,
    }) as unknown as Response) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

test("posts the first-factor payload to the same-origin Authelia API", async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init })
    return { ok: true, status: 200, redirected: false } as unknown as Response
  }) as unknown as typeof fetch

  const result = await submitLogin({ username: "lzj", password: "secret", remember: true })

  expect(result).toEqual({ ok: true })
  expect(seen).toHaveLength(1)
  expect(seen[0].url).toBe("/auth/api/firstfactor")
  expect(seen[0].init?.method).toBe("POST")
  expect(seen[0].init?.credentials).toBe("same-origin")
  expect(JSON.parse(String(seen[0].init?.body))).toEqual({
    username: "lzj",
    password: "secret",
    keepMeLoggedIn: true,
  })
})

test("maps bad credentials, throttling and transport failures", async () => {
  answer(401)
  expect(await submitLogin({ username: "a", password: "b", remember: false })).toEqual({
    ok: false,
    reason: "invalid",
  })

  answer(403)
  expect(await submitLogin({ username: "a", password: "b", remember: false })).toEqual({
    ok: false,
    reason: "throttled",
  })

  answer(429)
  expect(await submitLogin({ username: "a", password: "b", remember: false })).toEqual({
    ok: false,
    reason: "throttled",
  })

  globalThis.fetch = (async () => {
    throw new Error("offline")
  }) as unknown as typeof fetch
  expect(await submitLogin({ username: "a", password: "b", remember: false })).toEqual({
    ok: false,
    reason: "network",
  })
})

test("a redirect is not treated as a successful login", async () => {
  answer(200, { redirected: true })
  expect(await submitLogin({ username: "a", password: "b", remember: false })).toEqual({
    ok: false,
    reason: "unexpected",
  })
})
