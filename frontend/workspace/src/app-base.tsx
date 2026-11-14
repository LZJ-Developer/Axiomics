import "@/index.css"
import { ErrorBoundary, type ParentProps } from "solid-js"
import { MetaProvider } from "@solidjs/meta"
import { I18nProvider } from "@axiomics/ui/context"
import { ThemeProvider } from "@axiomics/ui/theme"
import { DialogProvider } from "@axiomics/ui/context/dialog"
import { LanguageProvider, useLanguage } from "@/context/language"
import { ErrorPage } from "./pages/error"
import "./app.css"

/**
 * Providers every Axiomics surface needs, without the server, SDK or session
 * graph. The desktop/web application wraps this with its data layer; the
 * public cases entry uses it directly so it can render without any tenant API.
 */
function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.locale, t: language.t }}>{props.children}</I18nProvider>
}

export function AppBaseProviders(
  props: ParentProps & { lockedScheme?: "light" | "dark"; initialScheme?: "light" | "dark" },
) {
  return (
    <MetaProvider>
      <ThemeProvider
        defaultTheme="axiomics"
        lockedScheme={props.lockedScheme}
        initialScheme={props.initialScheme}
      >
        <LanguageProvider>
          <UiI18nBridge>
            <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
              <DialogProvider>{props.children}</DialogProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}
