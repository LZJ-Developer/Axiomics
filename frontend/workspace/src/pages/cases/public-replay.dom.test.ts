import { afterAll, afterEach, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import type { Recording } from "./timeline"
import type { JSX } from "solid-js"
import type { Session } from "@axiomics/sdk/v2"
import { createServer } from "vite"
import solid from "vite-plugin-solid"
import { recording } from "./recording.fixture"

const vite = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../../../", import.meta.url)),
  mode: "production",
  logLevel: "silent",
  plugins: [solid({ ssr: false, dev: false })],
  server: { middlewareMode: true, watch: null },
  appType: "custom",
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) },
    conditions: ["browser", "production"],
    dedupe: ["solid-js", "solid-js/web"],
  },
  ssr: { noExternal: true, external: ["fuzzysort"], resolve: { conditions: ["browser", "production"] } },
})

const web = (await vite.ssrLoadModule("solid-js/web")) as typeof import("solid-js/web")
const appBase = (await vite.ssrLoadModule("@/app-base")) as typeof import("@/app-base")
const platformContext = (await vite.ssrLoadModule("@/context/platform")) as typeof import("@/context/platform")
const renderProviders = (await vite.ssrLoadModule("@/pages/session-render-providers")) as typeof import(
  "@/pages/session-render-providers"
)
const gallery = (await vite.ssrLoadModule("@/pages/cases-gallery")) as typeof import("@/pages/cases-gallery")
const publicReplay = (await vite.ssrLoadModule("@/pages/cases/public-replay")) as typeof import(
  "@/pages/cases/public-replay"
)
const timeline = (await vite.ssrLoadModule("@/pages/cases/timeline")) as typeof import("./timeline")
const catalog = (await vite.ssrLoadModule("@/pages/cases/catalog")) as typeof import("./catalog")

// The public entry computes its login target from `location`; happy-dom starts
// at `about:blank`, which has an opaque origin. Give these tests the deployed
// public origin (:8444) so the portal link is exercised for real.
type HappyWindow = Window & { happyDOM?: { setURL(url: string): void } }
;(window as HappyWindow).happyDOM?.setURL("http://localhost:8444/")

const realFetch = globalThis.fetch
let calls: string[] = []

function serve(payload: unknown) {
  calls = []
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => payload,
    } as unknown as Response
  }) as typeof fetch
}

const platform: import("@/context/platform").Platform = {
  platform: "web",
  openLink() {},
  restart: async () => {},
  notify: async () => undefined,
  back() {},
  forward() {},
}

const cleanups: Array<() => void> = []
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const ready = async (check: () => boolean) => {
  for (let index = 0; index < 150 && !check(); index++) await settle()
  expect(check()).toBe(true)
}

/** AppBaseProviders is the whole public boot path; the replay additionally
 * needs the markdown/diff/code/science renderers. No Router, Server or SDK
 * provider is mounted, so any tenant call would be a test failure. */
function mount(view: () => JSX.Element, sessionRenderers = false) {
  const host = document.createElement("div")
  document.body.append(host)
  cleanups.push(
    web.render(
      () =>
        platformContext.PlatformProvider({
          value: platform,
          get children() {
            return appBase.AppBaseProviders({
              initialScheme: "light",
              get children() {
                if (!sessionRenderers) return view()
                return renderProviders.SessionRenderProviders({
                  get children() {
                    return view()
                  },
                })
              },
            })
          },
        }),
      host,
    ),
  )
  return host
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.replaceChildren()
  globalThis.fetch = realFetch
  ;(window as HappyWindow).happyDOM?.setURL("http://localhost:8444/")
})
afterAll(() => vite.close())

test("the public gallery renders one plain replay anchor per case and fetches nothing", async () => {
  serve({})
  const host = mount(() => gallery.default({ public: true }))

  await ready(() => host.querySelectorAll(".case-card").length === 8)
  const cards = [...host.querySelectorAll<HTMLAnchorElement>("a.case-card")]
  expect(cards).toHaveLength(8)
  expect(cards.map((card) => card.getAttribute("data-case"))).toEqual(catalog.cases.map((item) => item.id))
  expect(cards.map((card) => card.getAttribute("href"))).toEqual(catalog.cases.map((item) => `#/replay/${item.id}`))
  // Every card is a plain <a>. Solid Router's <A> renders a `link` attribute
  // and active/inactive classes, and it would require a Router; neither is
  // present, so a click can never enter the SPA router or call a tenant API.
  expect(cards.every((card) => card.tagName === "A")).toBe(true)
  expect(cards.every((card) => !card.hasAttribute("link"))).toBe(true)
  expect(cards.every((card) => card.className === "case-card")).toBe(true)
  expect(calls).toEqual([])

  // "New research" opens the anonymous conversation rather than the portal:
  // the visitor types first, and only submitting asks for an account. `/`
  // without a cookie is this same gallery, so no nav link may point at it.
  const navLinks = [...host.querySelectorAll<HTMLAnchorElement>(".cases-nav a")]
  expect(navLinks.some((link) => link.getAttribute("href") === "/")).toBe(false)
  expect(navLinks.some((link) => (link.getAttribute("href") ?? "").includes("/auth"))).toBe(false)
  expect(navLinks.some((link) => link.getAttribute("href") === "#/new")).toBe(true)
})

test("new research leaves the gallery for the anonymous conversation, not for login", async () => {
  serve({})
  const host = mount(() => gallery.default({ public: true }))
  await ready(() => host.querySelectorAll(".case-card").length === 8)

  const start = [...host.querySelectorAll<HTMLAnchorElement>(".cases-nav a")].find(
    (link) => link.getAttribute("href") === "#/new",
  )
  expect(start).toBeDefined()
  start!.click()

  // A hash change is a navigation inside the static shell: no fetch and no
  // redirect to the portal before the visitor has typed anything.
  await Promise.resolve()
  expect(host.querySelector(".case-card")).not.toBeNull()
  expect(calls).toEqual([])
})

test("signing out explains itself in a dialog, and dismissing it actually closes", async () => {
  // The edge sends a signed-out visitor to `?signedout=1`. This is the only
  // place that says the CAS session is still alive, so it has to be seen: a
  // banner above the fold reads as decoration and gets skimmed past.
  ;(window as HappyWindow).happyDOM?.setURL("http://localhost:8444/?signedout=1")
  serve({})
  const host = mount(() => gallery.default({ public: true }))
  await ready(() => host.querySelector(".case-card") !== null)

  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')
  expect(dialog).not.toBeNull()
  expect(dialog!.getAttribute("aria-modal")).toBe("true")
  expect(dialog!.textContent).toContain("Signed out")
  // The gallery stays behind it: this is a message on the page, not a redirect.
  expect(host.querySelectorAll(".case-card")).toHaveLength(8)

  const btn = host.querySelector<HTMLButtonElement>(".cases-dialog__primary")
  expect(btn).not.toBeNull()
  btn!.click()
  await Promise.resolve()
  expect(window.location.search).toBe("")
  // Both halves matter. A dialog that only rewrites the URL stays on screen
  // (a non-reactive flag), which looks like a button that does nothing.
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(window.location.search).toBe("")
})

test("a login trigger navigates to the edge SSO entry instead of collecting a password", async () => {
  const source = recording()
  const fixture: { session: Session; recording: Recording } = JSON.parse(
    JSON.stringify({ session: source.session, recording: source.messages }),
  )
  serve(fixture)

  // The workspace shell's buttons used to open a dialog that POSTed credentials
  // to /auth/api/firstfactor. There is no such endpoint behind CAS: the only
  // correct action is leaving for the edge, which forwards to the identity
  // provider. Capture the navigation instead of performing it.
  const visited: string[] = []
  const location = window.location as unknown as { assign: (url: string) => void }
  const assign = location.assign
  location.assign = (url: string) => void visited.push(url)

  try {
    const host = mount(() => publicReplay.default({ caseID: "scenic-action" }), true)
    await ready(() => host.querySelector(".public-replay__login") !== null)

    host.querySelector<HTMLButtonElement>(".public-replay__login")!.click()
    await Promise.resolve()

    expect(visited).toHaveLength(1)
    const target = new URL(visited[0], "http://localhost:8444/")
    expect(target.origin).toBe("http://localhost:8444")
    expect(target.pathname).toBe("/auth")
    // rd points at the authenticated entry, never back at the static shell:
    // returning to cases.html after login would hit the app with no such route.
    // A path, because the shim refuses an absolute URL and substitutes its own.
    expect(target.searchParams.get("rd")).toBe("/axiomics")
    // And nothing was posted to an auth endpoint: the only fetch here is the
    // replay fixture the page loads for itself.
    expect(calls.filter((url) => url.includes("/auth"))).toEqual([])
  } finally {
    location.assign = assign
  }
})

test("the public replay renders the recorded transcript from one static fixture without tenant requests", async () => {
  const source = recording()
  const fixture: { session: Session; recording: Recording } = JSON.parse(
    JSON.stringify({ session: source.session, recording: source.messages }),
  )
  const frames = timeline.timeline(fixture.recording).length
  serve(fixture)

  const host = mount(() => publicReplay.default({ caseID: "scenic-action" }), true)
  await ready(() => host.textContent?.includes("First question") === true)

  const position = () => host.querySelector(".case-player__position")?.textContent?.trim() ?? ""
  const toggle = () => host.querySelector<HTMLButtonElement>(".case-player__toggle")!
  // A case page is opened to be watched: playback runs without a click.
  expect(toggle().textContent).toContain("Pause")
  // Pause it so the keyboard assertions below are not racing the clock.
  toggle().click()
  await ready(() => toggle().textContent?.includes("Continue") === true)
  expect(position()).toBe(`1 / ${frames}`)
  expect(host.textContent).not.toContain("Final answer")

  // ArrowRight steps the player one frame; the public page keeps the same
  // keyboard contract as the workbench replay.
  for (let index = 1; index < frames; index++)
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))

  await ready(() => position() === `${frames} / ${frames}`)
  await ready(() => host.textContent?.includes("Final answer") === true)
  expect(host.textContent).toContain("First question")
  expect(host.textContent).toContain("Later question")
  expect(host.querySelector('[data-slot="session-turn-final-response"]')?.textContent).toContain("Final answer")

  expect(calls).toEqual(["/cases/replay/scenic-action.json"])
  expect(calls.filter((url) => /\/(api|session|project|event|pty)(\/|\?|$)/.test(url))).toEqual([])

  // The shell follows the workbench session: the rail lists the cases so any
  // replay is one click away, the header returns to the gallery, and the
  // inspector starts collapsed like the workspace's own right pane.
  const rail = [...host.querySelectorAll<HTMLAnchorElement>(".public-replay__rail .session-sidebar__session-main")]
  expect(rail.map((link) => link.getAttribute("href"))).toEqual(
    catalog.cases.map((entry) => `#/replay/${encodeURIComponent(entry.id)}`),
  )
  // happy-dom normalises a bare `#/` to `#`; both return to the gallery.
  expect(host.querySelector(".public-replay__back")?.getAttribute("href")).toMatch(/^#\/?$/)
  expect(host.querySelector(".public-inspector")?.getAttribute("data-open")).toBe("false")
  expect(host.querySelector(".public-replay__switch")).toBeNull()
})

test("a case id with no recording stays on the public page instead of the workspace recovery screen", async () => {
  // A resource that failed throws on read, so reading it from the page would
  // hand the error to the app-wide boundary and replace this public surface
  // with "Axiomics hit a problem". A dead case link must show the replay
  // error state with a way back to the gallery instead.
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) } as unknown as Response
  }) as typeof fetch
  calls = []

  const host = mount(() => publicReplay.default({ caseID: "does-not-exist" }), true)

  await ready(() => host.querySelector('.case-replay-status[role="alert"]') !== null)
  expect(host.textContent).not.toContain("Axiomics hit a problem")
  expect(host.textContent).not.toContain("Workspace recovery")
  expect(host.querySelector(".public-replay__rail")).not.toBeNull()
  // happy-dom normalises a bare `#/` to `#`; both return to the gallery.
  expect(host.querySelector<HTMLAnchorElement>(".case-replay-status a")?.getAttribute("href")).toMatch(/^#\/?$/)
  expect(calls).toEqual(["/cases/replay/does-not-exist.json"])
})

test("the workbench mounts the same replay without the public rail", async () => {
  const source = recording()
  const fixture: { session: Session; recording: Recording } = JSON.parse(
    JSON.stringify({ session: source.session, recording: source.messages }),
  )
  serve(fixture)

  const host = mount(() => publicReplay.default({ caseID: "scenic-action", embedded: true }), true)
  await ready(() => host.textContent?.includes("First question") === true)

  // The workbench already owns a rail, and a signed-in visitor must not be
  // offered the public sign-in entry from inside it.
  expect(host.querySelector(".public-replay__rail")).toBeNull()
  expect(host.querySelector(".public-replay__login")).toBeNull()
  expect(host.querySelector(".public-replay__rail-toggle")).toBeNull()
  // Leaving a showcase returns to the gallery, not to the anonymous entry.
  expect(host.querySelector<HTMLAnchorElement>(".public-replay__back")?.getAttribute("href")).toBe("/cases")
  expect(calls).toEqual(["/cases/replay/scenic-action.json"])
})
