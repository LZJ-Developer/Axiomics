// @refresh reload
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { Platform, PlatformProvider } from "@/context/platform"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { axiomicsFetch } from "@/utils/axiomics-fetch"
import { openNativeDirectoryPicker } from "@/utils/native-picker"
import { normalizeServerUrl } from "@/context/server"
import { resolveDefaultServerUrl, resolveDesktopServerUrl } from "@/config/server-url"
import pkg from "../package.json"

const DEFAULT_SERVER_URL_KEY = "axiomics.settings.dat:defaultServerUrl"
const desktopUrl = resolveDesktopServerUrl(location.search, window.location.origin)

const stored = () => {
  if (desktopUrl) return
  // Reading `localStorage` itself can throw (storage access denied), so the
  // existence check has to sit inside the guard too.
  try {
    if (typeof localStorage === "undefined") return
    return normalizeServerUrl(localStorage.getItem(DEFAULT_SERVER_URL_KEY) ?? "")
  } catch {
    return
  }
}

const configured = () => {
  const direct = normalizeServerUrl(import.meta.env.VITE_AXIOMICS_SERVER_URL ?? "")
  if (direct) return direct
  const host = import.meta.env.VITE_AXIOMICS_SERVER_HOST
  const port = import.meta.env.VITE_AXIOMICS_SERVER_PORT
  if (!host && !port) return
  return normalizeServerUrl(`http://${host ?? "localhost"}:${port ?? "4096"}`)
}

const server = () =>
  resolveDefaultServerUrl({
    explicit: desktopUrl,
    stored: stored(),
    configured: configured(),
    hostname: location.hostname,
    origin: window.location.origin,
    dev: import.meta.env.DEV,
  })

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  const locale = (() => {
    if (typeof navigator !== "object") return "en" as const
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const language of languages) {
      if (!language) continue
      if (language.toLowerCase().startsWith("zh")) return "zh" as const
    }
    return "en" as const
  })()
  const key = "error.dev.rootNotFound" as const
  const message = locale === "zh" ? (zh[key] ?? en[key]) : en[key]
  throw new Error(message)
}

const platform: Platform = {
  platform: desktopUrl ? "desktop" : "web",
  version: import.meta.env.VITE_AXIOMICS_VERSION || pkg.version,
  openLink(url: string) {
    window.open(url, "_blank", "noopener,noreferrer")
  },
  back() {
    window.history.back()
  },
  forward() {
    window.history.forward()
  },
  restart: async () => {
    window.location.reload()
  },
  notify: async (title, description, href) => {
    if (!("Notification" in window)) return
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission().catch(() => "denied")
        : Notification.permission
    if (permission !== "granted") return
    const inView = document.visibilityState === "visible" && document.hasFocus()
    if (inView) return
    await Promise.resolve()
      .then(() => {
        const notification = new Notification(title, { body: description ?? "" })
        notification.onclick = () => {
          window.focus()
          if (href) {
            window.history.pushState(null, "", href)
            window.dispatchEvent(new PopStateEvent("popstate"))
          }
          notification.close()
        }
      })
      .catch(() => undefined)
  },
  openDirectoryPickerDialog: (options) => openNativeDirectoryPicker(options, axiomicsFetch),
  getDefaultServerUrl: () => stored() ?? null,
  setDefaultServerUrl: (url) => {
    if (desktopUrl) return
    try {
      if (typeof localStorage === "undefined") return
      if (url) {
        localStorage.setItem(DEFAULT_SERVER_URL_KEY, url)
        return
      }
      localStorage.removeItem(DEFAULT_SERVER_URL_KEY)
    } catch {
      return
    }
  },
  fetch: axiomicsFetch,
}

render(
  () => (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <AppInterface defaultUrl={desktopUrl} />
      </AppBaseProviders>
    </PlatformProvider>
  ),
  root!,
)
