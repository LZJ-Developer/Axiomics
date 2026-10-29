import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import solid from "vite-plugin-solid"
import type { JSX } from "solid-js"

const cleanups: Array<() => void> = []
const server = await createServer({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  mode: "production",
  logLevel: "silent",
  plugins: [solid({ ssr: false, dev: false })],
  server: { middlewareMode: true },
  appType: "custom",
  resolve: { conditions: ["browser", "production"], dedupe: ["solid-js", "solid-js/web"] },
  ssr: {
    noExternal: true,
    resolve: { conditions: ["browser", "production"] },
  },
})
const [fixture, web] = await Promise.all([
  server.ssrLoadModule("/src/components/settings/panel-stack.fixture.tsx") as Promise<
    typeof import("./panel-stack.fixture")
  >,
  server.ssrLoadModule("solid-js/web") as Promise<typeof import("solid-js/web")>,
])

afterAll(() => server.close())
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.replaceChildren()
})

const mount = (view: () => JSX.Element) => {
  const host = document.createElement("div")
  document.body.append(host)
  cleanups.push(web.render(view, host))
  return host
}

describe("SettingsPanelStack", () => {
  test("keeps visited panels mounted while exposing only the active panel", async () => {
    let select!: (id: "permissions" | "network") => void
    const harness = fixture.createPanelStackFixture((next) => (select = next))
    const host = mount(harness.view)

    const permissions = host.querySelector<HTMLElement>('[data-settings-panel="permissions"]')!
    const network = host.querySelector<HTMLElement>('[data-settings-panel="network"]')!
    expect(permissions.hidden).toBe(false)
    expect(permissions.hasAttribute("inert")).toBe(false)
    expect(permissions.getAttribute("aria-hidden")).toBeNull()
    expect(network.hidden).toBe(true)
    expect(network.hasAttribute("inert")).toBe(true)
    expect(network.getAttribute("aria-hidden")).toBe("true")

    const permissionFilter = host.querySelector<HTMLInputElement>('[aria-label="Permission filter"]')!
    permissionFilter.focus()
    expect(document.activeElement).toBe(permissionFilter)

    select("network")
    await Promise.resolve()
    expect(permissions.hidden).toBe(true)
    expect(permissions.hasAttribute("inert")).toBe(true)
    expect(permissions.getAttribute("aria-hidden")).toBe("true")
    expect(network.hidden).toBe(false)
    expect(network.hasAttribute("inert")).toBe(false)
    expect(network.getAttribute("aria-hidden")).toBeNull()
    expect(document.activeElement).toBe(network)
    select("permissions")

    expect(harness.mounts).toEqual({ permissions: 1, network: 1 })
    expect(permissionFilter.value).toBe("remember me")
    expect(host.querySelector(".settings-panel-loading")).toBeNull()
  })
})
