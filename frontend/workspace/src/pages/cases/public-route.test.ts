import { describe, expect, test } from "bun:test"
import { parseReplayHash, portalLoginHref } from "./public-route"

describe("parseReplayHash", () => {
  test("reads a plain case id", () => {
    expect(parseReplayHash("#/replay/scenic-action")).toBe("scenic-action")
  })

  test("decodes percent-encoded ids exactly once", () => {
    expect(parseReplayHash("#/replay/prj%2Ffolder")).toBe("prj/folder")
    expect(parseReplayHash("#/replay/%E6%A1%88%E4%BE%8B")).toBe("案例")
    // A literal percent sequence survives only when it is itself escaped.
    expect(parseReplayHash("#/replay/100%25")).toBe("100%")
    expect(parseReplayHash("#/replay/100%2525")).toBe("100%25")
  })

  test("rejects an empty replay id", () => {
    expect(parseReplayHash("#/replay/")).toBeUndefined()
  })

  test("keeps nested path segments inside the case id", () => {
    expect(parseReplayHash("#/replay/a/b")).toBe("a/b")
  })

  test("rejects hashes that are not replay routes", () => {
    expect(parseReplayHash("")).toBeUndefined()
    expect(parseReplayHash("#")).toBeUndefined()
    expect(parseReplayHash("#/")).toBeUndefined()
    expect(parseReplayHash("#/cases")).toBeUndefined()
    expect(parseReplayHash("#/replay")).toBeUndefined()
    expect(parseReplayHash("#/replays/scenic-action")).toBeUndefined()
    expect(parseReplayHash("/replay/scenic-action")).toBeUndefined()
  })

  test("rejects malformed percent escapes instead of throwing", () => {
    expect(parseReplayHash("#/replay/%E0%A4%A")).toBeUndefined()
    expect(parseReplayHash("#/replay/%")).toBeUndefined()
  })
})

describe("portalLoginHref", () => {
  test("targets the same-origin /auth portal and returns to the app entry", () => {
    const href = portalLoginHref("https://192.0.2.229:8444/axiomics")!
    const url = new URL(href)
    expect(url.origin).toBe("https://192.0.2.229:8444")
    expect(url.pathname).toBe("/auth")
    // rd must be the authenticated app, otherwise a successful login lands on
    // cases.html and the app has no route for it. It is a path: the shim drops
    // an absolute URL and substitutes its own default.
    expect(url.searchParams.get("rd")).toBe("/axiomics")
  })

  test("drops the public path and hash from the origin", () => {
    const fromGallery = portalLoginHref("https://host:8444/")!
    const fromReplay = portalLoginHref("https://host:8444/cases.html#/replay/scenic-action")!
    expect(fromReplay).toBe(fromGallery)
  })

  test("keeps a non-standard public host and escapes rd once", () => {
    const url = new URL(portalLoginHref("http://127.0.0.1:4173/")!)
    expect(url.origin).toBe("http://127.0.0.1:4173")
    expect(url.pathname).toBe("/auth")
    expect(url.searchParams.get("rd")).toBe("/axiomics")
    expect(decodeURIComponent(url.search.split("rd=")[1]!)).toBe("/axiomics")
  })

  test("returns undefined for input that is not a URL", () => {
    expect(portalLoginHref("")).toBeUndefined()
    expect(portalLoginHref("not a url")).toBeUndefined()
    // Opaque origins cannot be used as a base for the app path.
    expect(portalLoginHref("about:blank")).toBeUndefined()
  })
})
