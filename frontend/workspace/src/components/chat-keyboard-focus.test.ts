import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const atlas = () => readFileSync(fileURLToPath(new URL("../styles/atlas.css", import.meta.url)), "utf8")
const shell = () => readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8")

test("chat and composer controls retain the shared visible keyboard focus ring", () => {
  const css = atlas()

  expect(css).toMatch(/:where\(button, \[role="button"\], a, input, textarea, select, \[tabindex\]\):focus-visible/)
  expect(css).not.toMatch(/\.session-scroller[^{}]*:focus-visible\s*\{[^}]*outline:\s*none\s*!important/s)
  expect(css).not.toMatch(
    /\[data-component="prompt-input"\][^{}]*:focus-visible\s*\{[^}]*outline:\s*none\s*!important/s,
  )
})

// The shell paints before any script runs, so index.html must name one explicit
// theme colour (the light default) instead of delegating to a media query.
test("the browser shell declares one explicit pre-script theme colour", () => {
  const html = shell()

  expect(html).toContain('<meta name="theme-color" content="#f5f6f7" />')
  expect(html).not.toContain('media="(prefers-color-scheme: dark)"')
  expect(html).not.toContain('content="#26241f"')
})
