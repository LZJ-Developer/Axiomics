import { lazy, Show, Suspense, createSignal, onCleanup, onMount } from "solid-js"
import { render } from "solid-js/web"
import { AppBaseProviders } from "@/app-base"
import { PlatformProvider, type Platform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import CasesGallery from "@/pages/cases-gallery"
import { parsePublicHash, type PublicView } from "@/pages/cases/public-route"

const PublicReplayShell = lazy(() => import("@/pages/cases/public-replay-shell"))

/**
 * Minimal web platform for the public entry. The replay shell passes
 * `parseMarkdown` through to the native parser only when one exists, so the
 * browser path deliberately leaves it undefined.
 */
const platform: Platform = {
  platform: "web",
  openLink(url) {
    window.open(url, "_blank", "noopener,noreferrer")
  },
  restart: async () => window.location.reload(),
  notify: async () => undefined,
  back() {
    window.history.back()
  },
  forward() {
    window.history.forward()
  },
}

function view() {
  return parsePublicHash(window.location.hash)
}

function PublicCases() {
  const language = useLanguage()
  const [current, setCurrent] = createSignal<PublicView>(view())
  onMount(() => {
    const update = () => setCurrent(view())
    window.addEventListener("hashchange", update)
    onCleanup(() => window.removeEventListener("hashchange", update))
  })
  // The replay and the empty conversation share one shell; only the gallery
  // stands alone, so a case id is simply absent for `#/new`.
  const caseID = () => {
    const value = current()
    return value.kind === "replay" ? value.id : undefined
  }
  return (
    <Show when={current().kind !== "gallery"} fallback={<CasesGallery public />}>
      <Suspense
        fallback={
          <p class="case-replay-status" role="status">
            {language.t("cases.replay.loading")}
          </p>
        }
      >
        <PublicReplayShell caseID={caseID()} />
      </Suspense>
    </Show>
  )
}

render(
  () => (
    <PlatformProvider value={platform}>
      {/* The public showcase is always light. `initialScheme` is a display
          override only: it does not overwrite the visitor's saved workbench
          dark-mode preference. */}
      <AppBaseProviders initialScheme="light">
        <PublicCases />
      </AppBaseProviders>
    </PlatformProvider>
  ),
  document.getElementById("root")!,
)
