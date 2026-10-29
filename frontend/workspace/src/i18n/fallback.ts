import type { Flatten, Translator } from "@solid-primitives/i18n"
import { dict as en } from "./en"

/**
 * The workspace translator signature. Components mounted without a
 * LanguageProvider (tests, fixtures, atlas low-level widgets) accept an
 * optional translator prop and fall back to {@link englishT}.
 */
export type Translate = Translator<Flatten<typeof en>>

const template = /\{\{\s*([^}]+?)\s*\}\}/g

function resolve(text: string, params?: Record<string, string | number>) {
  if (!params) return text
  return text.replace(template, (_, raw) => String(params[String(raw)] ?? ""))
}

/** English translator used when a component renders outside the provider. */
export const englishT = ((key: string, params?: Record<string, string | number>) =>
  resolve((en as Record<string, string>)[key] ?? key, params)) as unknown as Translate

/**
 * Translator for plain functions that run outside a component (confirmation
 * dialogs, toast helpers). The provider installs the active locale here so a
 * dialog opened from anywhere still speaks the user's language.
 */
let current: Translate = englishT

export function setTranslator(next: Translate) {
  current = next
}

export const translate = ((key: string, params?: Record<string, string | number>) =>
  (current as unknown as (k: string, p?: Record<string, string | number>) => string)(key, params)) as Translate
