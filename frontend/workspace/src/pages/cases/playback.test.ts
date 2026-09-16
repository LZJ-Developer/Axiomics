import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { playback } from "./playback"

test("playback starts paused, steps one frame, clamps seeks and restarts", () => {
  createRoot((dispose) => {
    const player = playback(100)

    expect(player.state).toMatchObject({ cursor: 1, playing: false, speed: 1, tick: 0 })
    player.step(1)
    expect(player.state).toMatchObject({ cursor: 2, playing: false })
    player.step(-100)
    expect(player.state.cursor).toBe(1)
    player.step(1_000)
    expect(player.state.cursor).toBe(100)
    player.toggle()
    expect(player.state).toMatchObject({ cursor: 1, playing: true })
    player.pause()
    expect(player.state.playing).toBe(false)
    player.seek(1_000)
    expect(player.state).toMatchObject({ cursor: 100, playing: false })
    player.seek(-1_000)
    expect(player.state.cursor).toBe(1)
    expect(player.state.tick).toBe(0)
    player.speed(4)
    expect(player.state.speed).toBe(4)
    dispose()
  })
})

test("empty playback remains stopped", () => {
  createRoot((dispose) => {
    const player = playback(0)
    player.toggle()
    player.step(1)
    expect(player.state).toMatchObject({ cursor: 0, playing: false })
    dispose()
  })
})
