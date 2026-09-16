import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createAutoScroll } from "./create-auto-scroll"

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.assign(globalThis, { ResizeObserver: globalThis.ResizeObserver ?? Observer })

function scroller() {
  const box = { height: 100, top: 0 }
  const element = document.createElement("div")
  Object.defineProperties(element, {
    clientHeight: { get: () => 100 },
    scrollHeight: { get: () => box.height },
    scrollTop: {
      get: () => box.top,
      set: (value: number) => {
        box.top = Math.max(0, Math.min(value, box.height - 100))
      },
    },
  })
  return { box, element }
}

test("keeps following when content grows before a delayed automatic scroll event", () => {
  createRoot((dispose) => {
    const view = scroller()
    const scroll = createAutoScroll({ working: () => true })
    scroll.scrollRef(view.element)

    scroll.scrollToBottom()
    view.box.height = 300
    scroll.handleScroll()

    expect(scroll.userScrolled()).toBe(false)
    expect(view.box.top).toBe(200)
    dispose()
  })
})

test("keeps following when a disclosure contracts before the next frame grows", () => {
  createRoot((dispose) => {
    const view = scroller()
    view.box.height = 500
    view.box.top = 400
    const scroll = createAutoScroll({ working: () => true })
    scroll.scrollRef(view.element)
    scroll.scrollToBottom()

    view.box.height = 250
    view.box.top = 150
    view.box.height = 300
    scroll.handleScroll()

    expect(scroll.userScrolled()).toBe(false)
    expect(view.box.top).toBe(200)
    dispose()
  })
})

test("keeps following a declared content update whose net height still grows", () => {
  createRoot((dispose) => {
    const view = scroller()
    view.box.height = 500
    view.box.top = 400
    const scroll = createAutoScroll({ working: () => true })
    scroll.scrollRef(view.element)
    scroll.scrollToBottom()

    scroll.prepare()
    view.box.height = 531
    view.box.top = 200
    scroll.handleScroll()
    scroll.settle()

    expect(scroll.userScrolled()).toBe(false)
    expect(view.box.top).toBe(431)
    dispose()
  })
})

test("still respects an upward wheel interaction", () => {
  createRoot((dispose) => {
    const view = scroller()
    view.box.height = 300
    view.box.top = 200
    const scroll = createAutoScroll({ working: () => true })
    scroll.scrollRef(view.element)
    scroll.scrollToBottom()

    scroll.prepare()
    view.element.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }))
    view.box.top = 0
    scroll.handleScroll()
    scroll.settle()
    scroll.scrollToBottom()

    expect(scroll.userScrolled()).toBe(true)
    expect(view.box.top).toBe(0)
    dispose()
  })
})
