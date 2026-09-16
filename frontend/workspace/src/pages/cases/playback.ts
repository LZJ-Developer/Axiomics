import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

/** Owned by the mounted recording; disposal cancels playback on navigation. */
export function playback(total: number) {
  const initial = Math.min(1, total)
  const [state, setState] = createStore({ cursor: initial, playing: false, speed: 1, tick: 0 })
  createEffect(() => {
    if (!state.playing) return
    const delay = Math.min(2600, Math.max(380, Math.round(30000 / Math.max(total, 1)))) / state.speed
    const timer = setInterval(() => {
      const cursor = Math.min(state.cursor + 1, total)
      setState({ cursor, playing: cursor < total, tick: state.tick + 1 })
    }, delay)
    onCleanup(() => clearInterval(timer))
  })
  return {
    state,
    toggle() {
      if (total <= initial) return
      if (state.cursor >= total) return setState({ cursor: initial, playing: true })
      setState("playing", (value) => !value)
    },
    seek(cursor: number) {
      if (!Number.isFinite(cursor)) return
      setState({ cursor: Math.max(initial, Math.min(Math.round(cursor), total)), playing: false })
    },
    pause() {
      setState("playing", false)
    },
    step(delta: number) {
      if (!Number.isFinite(delta)) return
      const cursor = Math.max(initial, Math.min(state.cursor + Math.round(delta), total))
      setState({ cursor, playing: false })
    },
    speed(value: number) {
      if ([0.5, 1, 2, 4].includes(value)) setState("speed", value)
    },
  }
}
