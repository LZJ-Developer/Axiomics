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
const loginDialog = (await vite.ssrLoadModule("@/pages/cases/login-dialog")) as typeof import(
  "@/pages/cases/login-dialog"
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

  // A hash change is a navigation inside the static shell: no fetch, no dialog,
  // and no redirect to the portal before the visitor has typed anything.
  await Promise.resolve()
  expect(host.querySelector(".login-dialog__panel")).toBeNull()
  expect(calls).toEqual([])
})

test("the login dialog posts to the Authelia API and only leaves on success", async () => {
  let status = 401
  let body: unknown
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body))
    return { ok: status === 200, status, redirected: false } as unknown as Response
  }) as typeof fetch

  let authenticated = 0
  const host = mount(() =>
    loginDialog.LoginDialog({
      open: true,
      onClose() {},
      onAuthenticated() {
        authenticated++
      },
    }),
  )

  const signup = host.querySelector<HTMLButtonElement>(".login-dialog__switch")
  expect(signup).not.toBeNull()
  expect(signup!.textContent).toContain("Create one")

  const user = host.querySelector<HTMLInputElement>('input[name="username"]')!
  const password = host.querySelector<HTMLInputElement>('input[name="password"]')!
  user.value = "lzj"
  user.dispatchEvent(new Event("input", { bubbles: true }))
  password.value = "secret"
  password.dispatchEvent(new Event("input", { bubbles: true }))

  const submit = () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))

  submit()
  await ready(() => host.querySelector(".login-dialog__error") !== null)
  // The test mounts without a stored locale, so the English dictionary is active.
  expect(host.querySelector(".login-dialog__error")?.textContent).toContain("Incorrect username or password.")
  expect(authenticated).toBe(0)
  expect(body).toEqual({ username: "lzj", password: "secret", keepMeLoggedIn: true })

  status = 200
  submit()
  await ready(() => authenticated === 1)
  expect(host.querySelector(".login-dialog__error")).toBeNull()
})

test("registration stays in the dialog and posts to the product signup route", async () => {
  const requests: Array<{ url: string; body?: any }> = []
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ status: "ok", data: "axiomics/probe_signup" }),
    } as unknown as Response
  }) as typeof fetch

  const host = mount(() =>
    loginDialog.LoginDialog({
      open: true,
      onClose() {},
    }),
  )

  host.querySelector<HTMLButtonElement>(".login-dialog__switch")!.click()
  await ready(() => host.querySelector('input[name="signup-username"]') !== null)

  const set = (name: string, value: string) => {
    const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
    input.value = value
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }
  set("signup-username", "probe_signup")
  set("signup-password", "secret-1")
  set("signup-confirm", "secret-1")

  host
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))

  await ready(() =>
    (host.querySelector(".login-dialog__title")?.textContent ?? "").includes("Registration submitted"),
  )

  const signup = requests.find((request) => request.url === "/signup/api")
  expect(signup?.body).toMatchObject({
    application: "app-axiomics-web",
    organization: "axiomics",
    username: "probe_signup",
    password: "secret-1",
  })
  // The product must not reach into the console namespace at all: the edge
  // route is what drops the session cookie Casdoor would otherwise mint, so
  // there is no logout call to make afterwards.
  expect(requests.some((request) => request.url.startsWith("/console/"))).toBe(false)
})

test("a pending account gets a closable dialog over the gallery, not a separate page", async () => {
  ;(window as HappyWindow).happyDOM?.setURL("http://localhost:8444/axiomics?pending=1")
  serve({})
  const host = mount(() => gallery.default({ public: true }))

  await ready(() => host.querySelector(".login-dialog__tag") !== null)
  expect(host.querySelector(".login-dialog__tag")?.textContent).toContain("In review")
  expect(host.querySelector(".login-dialog__title")?.textContent).toContain(
    "awaiting administrator approval",
  )
  // The gallery is still the page behind the dialog.
  expect(host.querySelectorAll(".case-card").length).toBe(8)

  host.querySelector<HTMLButtonElement>(".login-dialog__submit")!.click()
  await ready(() => host.querySelector(".login-dialog__panel") === null)
  // Closing drops the marker so a refresh returns to the plain gallery.
  expect(window.location.search).toBe("")
})

test("the pending dialog can be closed with its close button", async () => {
  let closed = 0
  const host = mount(() =>
    loginDialog.LoginDialog({
      open: true,
      initialMode: "pending",
      onClose() {
        closed++
      },
    }),
  )

  await ready(() => host.querySelector(".login-dialog__tag") !== null)
  host.querySelector<HTMLButtonElement>(".login-dialog__close")!.click()
  expect(closed).toBe(1)
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
