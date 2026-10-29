import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { Button } from "@axiomics/ui/button"
import { Icon } from "@axiomics/ui/icon"
import { Switch } from "@axiomics/ui/switch"
import { useDialog } from "@axiomics/ui/context/dialog"
import { confirmDialog } from "@/atlas/dialogs"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { networkEndpoint } from "./network-endpoint"
import { canonicalNetworkDomain } from "./network-domain"
import { commitNetworkState, type NetworkSettingsState } from "./network-write"
import { PanelBody, PanelHeader, PanelScroll, Section } from "./_shared"
import "./preference-panels.css"

export { networkEndpoint } from "./network-endpoint"

// Outbound domain allow-list. Wired to a real backend store:
// GET/PUT /settings/network (backend/cli/src/settings/network.ts). The catalog
// of science-connector domain groups is served by the backend; this panel
// persists which groups are enabled plus any custom domains. The effective
// allow-list is readable by the backend via Network.allowlist().

type Group = { id: string; label: string; description: string; domains: string[] }
type State = NetworkSettingsState

const emptyState: State = { allowlistEnabled: false, enabled: [], custom: [] }

export default function Network() {
  const sdk = useGlobalSDK()
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const doFetch = platform.fetch ?? fetch

  const [catalog, setCatalog] = createSignal<Group[]>([])
  const [state, setState] = createSignal<State>(emptyState)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [customDomain, setCustomDomain] = createSignal("")
  let confirmedState = emptyState
  let queuedState: State | undefined
  let writeLoop: Promise<void> | undefined

  const endpoint = () => networkEndpoint(sdk.url)

  async function load() {
    setLoading(true)
    setError(undefined)
    try {
      const res = await doFetch(endpoint())
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { catalog: Group[]; state: State }
      setCatalog(data.catalog)
      confirmedState = data.state
      setState(data.state)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function persist(next: State) {
    // Keep controls responsive while preserving the endpoint's whole-state
    // replacement contract. Rapid edits collapse into the latest queued state
    // and writes still reach the backend strictly in order.
    setState(next)
    queuedState = next
    setError(undefined)
    if (writeLoop) return writeLoop

    setSaving(true)
    const loop = (async () => {
      while (queuedState) {
        const pending = queuedState
        queuedState = undefined
        const result = await commitNetworkState(pending, {
          isSaving: () => false,
          state: () => confirmedState,
          setState: (value) => {
            confirmedState = value
          },
          setSaving: () => {},
          setError,
          write: async (value) => {
            const res = await doFetch(endpoint(), {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(value),
            })
            if (!res.ok) throw new Error(await res.text())
            const data = (await res.json()) as { state: State }
            return data.state
          },
        })
        if (!result.ok) {
          queuedState = undefined
          setState(confirmedState)
          break
        }
        if (!queuedState) setState(confirmedState)
      }
    })()
    writeLoop = loop
    try {
      await loop
    } finally {
      if (writeLoop === loop) writeLoop = undefined
      setSaving(false)
    }
  }

  function toggleAllowlist(on: boolean) {
    void persist({ ...state(), allowlistEnabled: on })
  }

  function toggleGroup(id: string, on: boolean) {
    const enabled = on ? [...new Set([...state().enabled, id])] : state().enabled.filter((g) => g !== id)
    void persist({ ...state(), enabled })
  }

  function toggleExpanded(id: string) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }))
  }

  function addCustom() {
    const result = canonicalNetworkDomain(customDomain())
    if (!result.ok) {
      setError(result.error)
      return
    }
    const raw = result.domain
    setCustomDomain("")
    setError(undefined)
    if (state().custom.includes(raw)) return
    void persist({ ...state(), custom: [...state().custom, raw] })
  }

  function removeCustom(domain: string) {
    void persist({ ...state(), custom: state().custom.filter((d) => d !== domain) })
  }

  async function clearCustom() {
    if (state().custom.length === 0) return
    const confirmed = await confirmDialog(dialog, {
      title: language.t("settings.network.domains.clearTitle"),
      message: language.t("settings.network.domains.clearMessage"),
      confirmLabel: language.t("settings.network.domains.clearConfirm"),
      danger: true,
    })
    if (!confirmed) return
    void persist({ ...state(), custom: [] })
  }

  const effectiveCount = createMemo(() => {
    const set = new Set(state().custom)
    for (const group of catalog()) if (state().enabled.includes(group.id)) for (const d of group.domains) set.add(d)
    return set.size
  })

  onMount(() => void load())

  return (
    <PanelScroll>
      <div
        class="settings-preferences-panel settings-preferences-panel--network"
        aria-busy={saving() ? "true" : undefined}
      >
        <PanelHeader
          title={language.t("settings.network.page.title")}
          description={language.t("settings.network.page.description")}
        />
        <PanelBody>
          <Show when={error()}>
            <div class="settings-alert" data-tone="critical" role="alert">
              <span>{error()}</span>
              <Button
                size="small"
                variant="secondary"
                class="settings-panel-action"
                disabled={loading() || saving()}
                onClick={() => void load()}
              >
                {language.t("settings.network.retry")}
              </Button>
            </div>
          </Show>

          <Show
            when={!loading() && !error()}
            fallback={
              <Show when={loading()}>
                <div
                  class="settings-panel-loading__rows settings-network-loading-rows"
                  role="status"
                  aria-label={language.t("settings.network.loading")}
                >
                  <span />
                  <span />
                  <span />
                </div>
              </Show>
            }
          >
            <Section
              title={language.t("settings.network.access.title")}
              description={language.t("settings.network.access.description")}
              action={
                <span class="settings-network-save-state" role="status" aria-live="polite">
                  {saving() ? language.t("settings.network.saving") : ""}
                </span>
              }
            >
              <div class="settings-card settings-preferences-card">
                <div class="settings-row settings-preference-row settings-network-policy-row">
                  <div class="settings-row-copy">
                    <strong>{language.t("settings.network.restrict.title")}</strong>
                    <span>
                      {state().allowlistEnabled
                        ? language.t("settings.network.restrict.on", { count: effectiveCount() })
                        : language.t("settings.network.restrict.off")}
                    </span>
                  </div>
                  <Switch hideLabel checked={state().allowlistEnabled} disabled={loading()} onChange={toggleAllowlist}>
                    {language.t("settings.network.restrict.title")}
                  </Switch>
                </div>
              </div>
            </Section>

            <Section
              title={language.t("settings.network.groups.title")}
              description={language.t("settings.network.groups.description")}
            >
              <Show
                when={!loading()}
                fallback={
                  <div
                    class="settings-panel-loading__rows settings-network-loading-rows"
                    role="status"
                    aria-label={language.t("settings.network.groups.loading")}
                  >
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                }
              >
                <div class="settings-card settings-preferences-card">
                  <For
                    each={catalog()}
                    fallback={
                      <p class="settings-card-empty" role="status">
                        {language.t("settings.network.groups.empty")}
                      </p>
                    }
                  >
                    {(group) => {
                      const on = () => state().enabled.includes(group.id)
                      const open = () => !!expanded()[group.id]
                      const detailsId = () => `network-group-${group.id}`
                      return (
                        <div class="settings-list-item">
                          <div class="settings-row settings-preference-row settings-network-group-row">
                            <button
                              type="button"
                              class="settings-network-disclosure"
                              onClick={() => toggleExpanded(group.id)}
                              aria-label={language.t(
                                open() ? "settings.network.groups.collapse" : "settings.network.groups.expand",
                                { name: group.label },
                              )}
                              aria-expanded={open()}
                              aria-controls={detailsId()}
                            >
                              <Icon
                                name={open() ? "chevron-down" : "chevron-right"}
                                size="small"
                                class="settings-network-disclosure__icon"
                              />
                              <span class="settings-row-copy">
                                <strong class="truncate">{group.label}</strong>
                                <span class="settings-network-group-description">
                                  {group.description} ·{" "}
                                  <span class="tabular-nums">
                                    {language.t("settings.network.groups.domains", {
                                      count: group.domains.length,
                                    })}
                                  </span>
                                </span>
                              </span>
                            </button>
                            <Switch hideLabel checked={on()} onChange={(v) => toggleGroup(group.id, v)}>
                              {language.t("settings.network.groups.allow", { name: group.label })}
                            </Switch>
                          </div>
                          <Show when={open()}>
                            <div id={detailsId()} class="settings-preference-disclosure">
                              <ul
                                class="settings-preference-domain-list"
                                aria-label={language.t("settings.network.groups.domainsAria", {
                                  name: group.label,
                                })}
                              >
                                <For each={group.domains}>
                                  {(domain) => (
                                    <li>
                                      <code>{domain}</code>
                                    </li>
                                  )}
                                </For>
                              </ul>
                            </div>
                          </Show>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </Section>

            <Section
              title={language.t("settings.network.domains.title")}
              description={language.t("settings.network.domains.description")}
              action={
                <Show when={state().custom.length > 0}>
                  <Button
                    size="small"
                    variant="ghost"
                    class="settings-panel-action settings-panel-action--danger-quiet"
                    onClick={clearCustom}
                    aria-label={language.t("settings.network.domains.clearAria")}
                  >
                    {language.t("settings.network.domains.clear")}
                  </Button>
                </Show>
              }
            >
              <Show
                when={!loading()}
                fallback={
                  <div
                    class="settings-panel-loading__rows settings-network-loading-rows settings-network-loading-rows--domains"
                    role="status"
                    aria-label={language.t("settings.network.domains.loading")}
                  >
                    <span />
                    <span />
                  </div>
                }
              >
                <div class="settings-card settings-preferences-card">
                  <For
                    each={state().custom}
                    fallback={
                      <p class="settings-card-empty" role="status">
                        {language.t("settings.network.domains.empty")}
                      </p>
                    }
                  >
                    {(domain) => (
                      <div class="settings-row settings-preference-row settings-network-domain-row group">
                        <code class="settings-network-domain-value max-w-full break-all whitespace-normal min-w-0 text-13-regular text-text-base">
                          {domain}
                        </code>
                        <button
                          type="button"
                          class="settings-icon-action text-icon-weak-base hover:text-text-danger"
                          onClick={() => removeCustom(domain)}
                          aria-label={language.t("settings.network.domains.remove", { domain })}
                        >
                          <Icon name="close-small" size="small" />
                        </button>
                      </div>
                    )}
                  </For>
                  <div class="settings-row settings-preference-row settings-network-add-row">
                    <input
                      type="text"
                      aria-label={language.t("settings.network.domains.input")}
                      placeholder={language.t("settings.network.domains.placeholder")}
                      value={customDomain()}
                      disabled={loading()}
                      class="settings-field min-w-0 flex-1 basis-[220px] font-mono"
                      onInput={(e) => setCustomDomain(e.currentTarget.value)}
                      onKeyDown={(e) => e.key === "Enter" && addCustom()}
                    />
                    <button
                      type="button"
                      class="settings-preference-action shrink-0"
                      data-variant="primary"
                      disabled={loading() || !customDomain().trim()}
                      onClick={addCustom}
                    >
                      {language.t("settings.network.domains.add")}
                    </button>
                  </div>
                </div>
              </Show>
            </Section>
          </Show>
        </PanelBody>
      </div>
    </PanelScroll>
  )
}
