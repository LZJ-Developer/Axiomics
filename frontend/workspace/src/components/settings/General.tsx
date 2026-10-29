import { Select } from "@axiomics/ui/select"
import { Show, createMemo, createSignal, onMount, type Component, type JSX } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { AppearanceSections } from "../settings-general"
import { PanelBody, PanelHeader, PanelScroll, Section } from "./_shared"
import { settingsApi } from "./api"
import { thresholdOptions, type ContextPreferences } from "./context-preferences"
import { commitPreference } from "./preference-write"
import "./preference-panels.css"

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export default function General() {
  const sdk = useGlobalSDK()
  const fetchFn = usePlatform().fetch ?? fetch

  // The context row reads and writes the effective compaction settings the backend
  // serves from axiomics.json through /settings/preferences.
  const language = useLanguage()
  const [error, setError] = createSignal<string>()
  const [context, setContext] = createSignal<ContextPreferences>()
  const [contextBusy, setContextBusy] = createSignal(false)
  onMount(() => {
    void settingsApi<ContextPreferences>(sdk.url, fetchFn, "/settings/preferences")
      .then((preferences) => setContext(preferences))
      .catch((cause) => setError(errorMessage(cause)))
  })
  const saveContext = async (patch: Partial<ContextPreferences>) => {
    if (contextBusy()) return
    setContextBusy(true)
    setError(undefined)
    const result = await commitPreference(
      () =>
        settingsApi<ContextPreferences>(sdk.url, fetchFn, "/settings/preferences", {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
      (saved) => setContext(saved),
    )
    setContextBusy(false)
    if (!result.ok) setError(result.error)
  }
  const thresholds = createMemo(() => thresholdOptions(context()?.compaction_threshold))
  const threshold = createMemo(() => thresholds().find((option) => option.value === context()?.compaction_threshold))

  return (
    <PanelScroll>
      <div class="settings-preferences-panel settings-preferences-panel--general">
        <PanelHeader
          title={language.t("settings.panel.general")}
          description={language.t("settings.general.description")}
        />
        <PanelBody>
          <Show when={error()}>
            <div class="settings-alert" data-tone="critical" role="alert">
              {error()}
            </div>
          </Show>

          <Section
            id="context"
            title={language.t("settings.general.section.context")}
            description={language.t("settings.general.section.context.description")}
          >
            <div class="settings-card settings-preferences-card">
              <AccountRow
                title={language.t("settings.general.context.threshold.title")}
                description={
                  context()?.compaction_auto === false
                    ? language.t("settings.general.context.threshold.off")
                    : language.t("settings.general.context.threshold.description")
                }
              >
                <Select
                  aria-label={language.t("settings.general.context.threshold.title")}
                  options={thresholds()}
                  current={threshold()}
                  value={(option) => String(option.value)}
                  label={(option) => option.label}
                  disabled={!context() || contextBusy()}
                  onSelect={(option) => {
                    if (!option || option.value === context()?.compaction_threshold) return
                    void saveContext({ compaction_threshold: option.value })
                  }}
                  variant="secondary"
                  size="small"
                  triggerVariant="settings"
                />
              </AccountRow>
            </div>
          </Section>

          <AppearanceSections />
        </PanelBody>
      </div>
    </PanelScroll>
  )
}

const AccountRow: Component<{
  title: string
  description: string
  children: JSX.Element
}> = (props) => (
  <div class="settings-row settings-preference-row">
    <div class="settings-row-copy">
      <strong>{props.title}</strong>
      <span>{props.description}</span>
    </div>
    <div class="settings-preference-row__actions">{props.children}</div>
  </div>
)
