import { afterAll, afterEach, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import type { JSX } from "solid-js"
import { createServer } from "vite"
import solid from "vite-plugin-solid"
import { recording } from "./recording.fixture"
import { snapshot, timeline } from "./timeline"

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: globalThis.ResizeObserver ?? Observer })
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
const solidjs = (await vite.ssrLoadModule("solid-js")) as typeof import("solid-js")
const store = (await vite.ssrLoadModule("solid-js/store")) as typeof import("solid-js/store")
const context = (await vite.ssrLoadModule("@axiomics/ui/context/data")) as typeof import("@axiomics/ui/context/data")
const dialog = (await vite.ssrLoadModule("@axiomics/ui/context/dialog")) as typeof import("@axiomics/ui/context/dialog")
const diff = (await vite.ssrLoadModule("@axiomics/ui/context/diff")) as typeof import("@axiomics/ui/context/diff")
const marked = (await vite.ssrLoadModule("@axiomics/ui/context/marked")) as typeof import("@axiomics/ui/context/marked")
const turn = (await vite.ssrLoadModule("@axiomics/ui/session-turn")) as typeof import("@axiomics/ui/session-turn")
const basic = (await vite.ssrLoadModule("@axiomics/ui/basic-tool")) as typeof import("@axiomics/ui/basic-tool")
await vite.ssrLoadModule("/src/science/tool-renderer.tsx")
const cleanups: Array<() => void> = []
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const ready = async (check: () => boolean) => {
  for (let index = 0; index < 100 && !check(); index++) await settle()
  expect(check()).toBe(true)
}
function mount(view: () => JSX.Element, data: Parameters<typeof context.DataProvider>[0]["data"]) {
  const host = document.createElement("div")
  document.body.append(host)
  cleanups.push(
    web.render(
      () =>
        context.DataProvider({
          data,
          directory: "/research",
          get children() {
            return dialog.DialogProvider({
              get children() {
                return diff.DiffComponentProvider({
                  component: () => null,
                  get children() {
                    return marked.MarkedProvider({
                      get children() {
                        return view()
                      },
                    })
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
})
afterAll(() => vite.close())

test("real SessionTurn preserves tool rendering and removes future output on backward seek", async () => {
  const source = recording()
  source.messages[1].parts.push({
    ...source.artifact,
    id: "prt_saved",
    tool: "artifact",
    state: {
      status: "completed",
      input: {},
      output: "Saved",
      title: "Saved",
      time: { start: 2, end: 3 },
      metadata: {
        savedArtifact: {
          id: "art_recorded",
          versionID: "version_1",
          version: 1,
          title: "Saved report",
          kind: "figure",
          path: "report.png",
          size: 12,
          sha256: "recorded-hash",
          preview: { kind: "image", data: "data:image/png;base64,cmVjb3JkZWQ=" },
        },
      },
    },
  })
  const frames = timeline(source.messages)
  const [view, setView] = store.createStore(snapshot(source.session, source.messages, frames, 1))
  const [expanded, setExpanded] = solidjs.createSignal(true)
  const host = mount(
    () =>
      solidjs.For({
        get each() {
          return view.message[source.session.id]
            .filter((message) => message.role === "user")
            .map((message) => message.id)
        },
        children: (id) =>
          turn.SessionTurn({
            sessionID: source.session.id,
            messageID: id,
            get stepsExpanded() {
              return expanded()
            },
          }),
      }),
    view,
  )
  await ready(() => host.textContent!.includes("First question"))
  expect(host.textContent).not.toContain("Final answer")
  expect(host.textContent).not.toContain("Later question")
  setView(store.reconcile(snapshot(source.session, source.messages, frames, 3)))
  await ready(() => host.querySelector('[data-component="delegation-card"]') !== null)
  setView(store.reconcile(snapshot(source.session, source.messages, frames, frames.length)))
  await ready(() => host.textContent!.includes("Final answer"))
  const answer = host.querySelector('[data-slot="session-turn-final-response"]')
  expect(answer?.textContent).toContain("Final answer")
  expect(host.querySelectorAll('[data-slot="assistant-prose"]')).toHaveLength(1)
  await ready(() => host.textContent!.includes("Recorded provider failure"))
  expect(host.textContent).toContain("Later question")
  expect(host.textContent).toContain("Recorded tool failure")
  // Both science envelopes and durable Results use their registered renderers.
  expect(host.querySelector('[data-component="tool-artifact"]')).not.toBeNull()
  const saved = host.querySelector('[data-tool="artifact"]')
  const trigger = saved?.querySelector<HTMLButtonElement>("button[aria-expanded]")
  expect(saved?.textContent).toContain("Saved to Results")
  expect(trigger?.getAttribute("aria-expanded")).toBe("false")
  trigger?.click()
  await ready(() => saved?.querySelector('[data-component="saved-artifact-tool"]') !== null)
  expect(host.querySelector<HTMLImageElement>('[data-slot="saved-artifact-preview"]')?.src).toContain(
    "data:image/png;base64,cmVjb3JkZWQ=",
  )
  expect(host.querySelector('[data-slot="session-turn-generated"]')).toBeNull()
  setExpanded(false)
  await ready(
    () => host.querySelector('[data-slot="session-turn-generated"]')?.textContent?.includes("Saved report") === true,
  )
  expect(host.querySelector('[data-slot="session-turn-final-response"]')?.textContent).toContain("Final answer")
  expect(host.querySelectorAll('[data-slot="assistant-prose"]')).toHaveLength(1)
  expect(host.querySelector('[data-component="saved-artifact-tool"]')).toBeNull()
  setExpanded(true)
  await ready(() => host.querySelector('[data-tool="artifact"]') !== null)
  const restored = host.querySelector('[data-tool="artifact"]')
  const reopen = restored?.querySelector<HTMLButtonElement>("button[aria-expanded]")
  expect(reopen?.getAttribute("aria-expanded")).toBe("false")
  reopen?.click()
  await ready(() => restored?.querySelector('[data-component="saved-artifact-tool"]') !== null)
  setView(store.reconcile(snapshot(source.session, source.messages, frames, 1)))
  await settle()
  expect(host.textContent).not.toContain("Final answer")
  expect(host.textContent).not.toContain("Later question")
  expect(host.textContent).not.toContain("Recorded provider failure")
  expect(host.querySelector('[data-component="delegation-card"]')).toBeNull()
  expect(host.querySelector('[data-component="tool-artifact"]')).toBeNull()
  expect(host.querySelector('[data-component="saved-artifact-tool"]')).toBeNull()
  expect(host.querySelector('[data-slot="session-turn-generated"]')).toBeNull()
  expect(source.task.state.status).toBe("completed")
})

test("the newest replay card opens and the previous card folds at each frame", async () => {
  const source = recording()
  source.messages[1].parts.splice(2, 0, {
    id: "prt_reasoning",
    messageID: "msg_002",
    sessionID: source.session.id,
    type: "reasoning",
    text: "Inspecting the recorded experiment before choosing a command.",
    time: { start: 1, end: 2 },
  })
  source.messages[1].parts.splice(-1, 0, {
    ...source.artifact,
    id: "prt_saved",
    tool: "artifact",
    state: {
      status: "completed",
      input: { action: "save_file", path: "figures/recorded.png" },
      output: "Saved",
      title: "Saved Result: Recorded figure",
      time: { start: 3, end: 4 },
      metadata: {
        savedArtifact: {
          id: "art_recorded",
          versionID: "version_1",
          version: 1,
          title: "Recorded figure",
          kind: "figure",
          path: "figures/recorded.png",
          mimeType: "image/png",
          size: 12,
          sha256: "recorded-hash",
          preview: { kind: "image", data: "data:image/png;base64,cmVjb3JkZWQ=" },
        },
      },
    },
  })
  const frames = timeline(source.messages)
  const cursor = (id: string) => frames.findIndex((frame) => frame.parts[0]?.id === id) + 1
  const [step, setStep] = solidjs.createSignal(1)
  const [view, setView] = store.createStore(snapshot(source.session, source.messages, frames, step()))
  const seek = (value: number) => {
    setStep(value)
    setView(store.reconcile(snapshot(source.session, source.messages, frames, value)))
  }
  const host = mount(
    () =>
      turn.SessionTurn({
        sessionID: source.session.id,
        messageID: "msg_001",
        stepsExpanded: true,
        get disclosure() {
          return { partID: frames[step() - 1]?.parts.at(-1)?.id, revision: step() }
        },
      }),
    view,
  )

  seek(cursor("prt_reasoning"))
  await ready(() => host.querySelector('[data-slot="reasoning-part-toggle"]')?.getAttribute("aria-expanded") === "true")

  seek(cursor("prt_task"))
  const task = () => host.querySelector<HTMLDetailsElement>('[data-component="delegation-card"]')
  await ready(() => task()?.open === true)
  expect(host.querySelector('[data-slot="reasoning-part-toggle"]')?.getAttribute("aria-expanded")).toBe("false")

  task()!.querySelector("summary")!.click()
  await ready(() => task()?.open === false)

  seek(cursor("prt_artifact"))
  const artifact = () => host.querySelector('[data-tool="science_table"]')
  await ready(() => !!artifact())
  expect(task()?.open).toBe(false)
  expect(artifact()?.querySelector("button")?.getAttribute("aria-expanded")).toBe("true")

  seek(cursor("prt_saved"))
  const saved = () => host.querySelector('[data-tool="artifact"]')
  await ready(() => saved()?.querySelector("button")?.getAttribute("aria-expanded") === "true")
  expect(artifact()?.querySelector("button")?.getAttribute("aria-expanded")).toBe("false")
  expect(saved()?.querySelector('[data-slot="saved-artifact-preview"]')).not.toBeNull()

  seek(cursor("prt_answer"))
  await ready(
    () =>
      host.querySelector('[data-slot="session-turn-final-response"]')?.textContent?.includes("Final answer") === true,
  )
  expect(host.querySelectorAll('[data-slot="assistant-prose"]')).toHaveLength(1)
  expect(saved()?.querySelector("button")?.getAttribute("aria-expanded")).toBe("false")
})

test("ordinary BasicTool still force-opens after a user closes it", async () => {
  const [state, setState] = store.createStore({ forced: false })
  const source = recording()
  const host = mount(
    () =>
      basic.BasicTool({
        icon: "console",
        defaultOpen: true,
        get forceOpen() {
          return state.forced
        },
        trigger: { title: "Permission tool" },
        children: "Tool details",
      }),
    snapshot(source.session, source.messages, [], 0),
  )
  await settle()
  const trigger = host.querySelector<HTMLButtonElement>("button[aria-expanded]")!
  expect(trigger.getAttribute("aria-expanded")).toBe("true")
  trigger.click()
  await settle()
  expect(trigger.getAttribute("aria-expanded")).toBe("false")
  setState("forced", true)
  await settle()
  expect(trigger.getAttribute("aria-expanded")).toBe("true")
})
