import { expect, test } from "bun:test"
import { forgetAccount } from "./signout"

class MemoryStorage implements Storage {
  data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
}

test("drops the previous account's cached data but keeps the theme", () => {
  const local = new MemoryStorage()
  local.setItem("axiomics.global.dat:globalSync.project:http://localhost:4096", "{}")
  local.setItem("axiomics.workspace.prj_a.dat:session:new:prompt", "draft")
  local.setItem("axiomics-session-tabs-v1", "[]")
  local.setItem("axiomics-theme-css-axiomics-light", ".x{}")

  forgetAccount(local, new MemoryStorage())

  expect([...local.data.keys()]).toEqual(["axiomics-theme-css-axiomics-light"])
})

test("leaves storage belonging to other products on the origin alone", () => {
  const local = new MemoryStorage()
  local.setItem("thesis-project-favorites-v1", "[]")
  local.setItem("axiomics.global.dat:server", "http://localhost:4096")

  forgetAccount(local, new MemoryStorage())

  expect(local.getItem("thesis-project-favorites-v1")).toBe("[]")
  expect(local.getItem("axiomics.global.dat:server")).toBe(null)
})

test("clears the per-tab store", () => {
  const session = new MemoryStorage()
  session.setItem("axiomics.workspace.prj_a.dat:workspace:terminal", "open")

  forgetAccount(new MemoryStorage(), session)

  expect(session.length).toBe(0)
})
