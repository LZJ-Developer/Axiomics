// Execution sandbox settings — the permission system decides *whether* the agent
// runs a shell command; it is not an isolation boundary. This panel turns on a
// real one: native containment that confines reads and writes to granted paths
// and denies network egress. The server
// (routes/settings/sandbox.ts) reports backend availability, persists the
// config, and runs the empirical self-test the browser can't. Mirrors the
// `axiomics sandbox` CLI.
import { Component, For, Show, createResource, createSignal, createUniqueId } from "solid-js"
import { Select } from "@axiomics/ui/select"
import { Button } from "@axiomics/ui/button"
import { Switch } from "@axiomics/ui/switch"
import { Icon } from "@axiomics/ui/icon"
import { showToast } from "@axiomics/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { settingsApi } from "./api"
import { PanelBody, PanelHeader, PanelScroll, Section } from "./_shared"
import "./preference-panels.css"
import "./sandbox.css"

interface SandboxConfig {
  enabled?: boolean
  network?: "allow" | "deny"
  allowWrite?: string[]
  onUnavailable?: "warn" | "error" | "allow"
  requireProjectTrust?: boolean
}
interface Status {
  platform: string
  backend: "seatbelt" | "bubblewrap" | "none"
  available: boolean
  readIsolation?: "grant_only" | "unavailable"
  networkIsolation?: "deny_all" | "unavailable"
  tool?: string
  reason?: string
}
interface Payload {
  config: SandboxConfig
  status: Status
}
interface Check {
  name: string
  pass: boolean
  skipped?: boolean
  detail?: string
}
interface SelfTest {
  backend: string
  available: boolean
  checks: Check[]
  ok: boolean
}

type WriteKey = "enabled" | "trust" | "network" | "fallback" | "paths"
type PendingWrite = { body: SandboxConfig; key: WriteKey; failure: string }

const NETWORK_OPTS = [
  { value: "allow" as const, labelKey: "settings.sandbox.option.allow" as const },
  { value: "deny" as const, labelKey: "settings.sandbox.option.deny" as const },
]
const UNAVAILABLE_OPTS = [
  { value: "warn" as const, labelKey: "settings.sandbox.option.warn" as const },
  { value: "error" as const, labelKey: "settings.sandbox.option.error" as const },
  { value: "allow" as const, labelKey: "settings.sandbox.option.silent" as const },
]

const Sandbox: Component = () => {
  const sdk = useGlobalSDK()
  const platform = usePlatform()
  const language = useLanguage()
  const fetchFn = platform.fetch ?? fetch
  const call = <T,>(path: string, init?: RequestInit) =>
    settingsApi<T>(sdk.url, fetchFn, `/settings/sandbox${path}`, init)

  const [data, { mutate, refetch }] = createResource(() => call<Payload>(""))
  const [busyKeys, setBusyKeys] = createSignal<ReadonlySet<WriteKey>>(new Set())
  const [saving, setSaving] = createSignal(false)
  const [test, setTest] = createSignal<SelfTest>()
  const [testing, setTesting] = createSignal(false)
  const [newPath, setNewPath] = createSignal("")
  const [showBackendDetails, setShowBackendDetails] = createSignal(false)
  const [showPathEditor, setShowPathEditor] = createSignal(false)
  const [showTestDetails, setShowTestDetails] = createSignal(false)
  const backendDetailsId = `sandbox-backend-${createUniqueId()}`
  const pathEditorId = `sandbox-path-${createUniqueId()}`
  const testDetailsId = `sandbox-test-${createUniqueId()}`
  const writeQueue: PendingWrite[] = []
  let writeLoop: Promise<void> | undefined

  const config = (): SandboxConfig =>
    data()?.config ?? {
      enabled: true,
      network: "deny",
      allowWrite: [],
      onUnavailable: "error",
      requireProjectTrust: false,
    }
  const status = () => data()?.status
  const unavailable = () => data.loading || !!data.error
  const busy = (key: WriteKey) => busyKeys().has(key)
  const setKeyBusy = (key: WriteKey, value: boolean) => {
    setBusyKeys((current) => {
      const next = new Set(current)
      if (value) next.add(key)
      else next.delete(key)
      return next
    })
  }
  // Older running servers may omit the two explicit capability fields while
  // still reporting a supported native backend. Seatbelt and bubblewrap have
  // fixed grant-only / deny-all semantics, so keep the UI truthful across the
  // rolling frontend/backend upgrade instead of labelling an active backend
  // unavailable or presenting its forced Deny policy as configurable.
  const nativeBackendActive = () => {
    const current = status()
    return !!current?.available && (current.backend === "seatbelt" || current.backend === "bubblewrap")
  }
  const grantOnlyEnforced = () => {
    const capability = status()?.readIsolation
    return capability === "grant_only" || (capability === undefined && nativeBackendActive())
  }
  const networkDenyEnforced = () => {
    const capability = status()?.networkIsolation
    return capability === "deny_all" || (capability === undefined && nativeBackendActive())
  }
  const effectiveNetwork = () => (networkDenyEnforced() ? "deny" : (config().network ?? "deny"))
  const pendingConfig = (base: SandboxConfig) =>
    writeQueue.reduce((current, item) => ({ ...current, ...item.body }), base)

  const drainWrites = async () => {
    setSaving(true)
    while (writeQueue.length > 0) {
      const item = writeQueue.shift()!
      try {
        const confirmed = await call<Payload>("", { method: "PUT", body: JSON.stringify(item.body) })
        // The response confirms this write. Re-apply later optimistic edits so
        // an older response never makes another control appear to jump back.
        mutate({ ...confirmed, config: pendingConfig(confirmed.config) })
      } catch (err) {
        const abandoned = writeQueue.splice(0)
        for (const pending of abandoned) setKeyBusy(pending.key, false)
        showToast({ title: item.failure, description: err instanceof Error ? err.message : String(err) })
        void refetch()
        break
      } finally {
        setKeyBusy(item.key, false)
      }
    }
    setSaving(false)
    writeLoop = undefined
  }

  const patch = (body: SandboxConfig, key: WriteKey, failure: string) => {
    if (unavailable() || busy(key)) return
    const current = data()
    if (!current) return

    // Apply feedback immediately, but serialize server writes. Other controls
    // remain usable; only the preference being committed is temporarily held.
    mutate({ ...current, config: { ...current.config, ...body } })
    setKeyBusy(key, true)
    writeQueue.push({ body, key, failure })
    writeLoop ??= drainWrites()
  }

  const runTest = async () => {
    if (testing()) return
    setTesting(true)
    try {
      setTest(await call<SelfTest>("/test", { method: "POST" }))
    } catch (err) {
      showToast({
        title: language.t("settings.sandbox.test.failedRun"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setTesting(false)
    }
  }

  const addPath = () => {
    const p = newPath().trim()
    if (!p) return
    if (!p.startsWith("/")) {
      showToast({
        title: language.t("settings.sandbox.paths.absoluteTitle"),
        description: language.t("settings.sandbox.paths.absoluteDetail"),
      })
      return
    }
    const next = [...(config().allowWrite ?? [])]
    if (!next.includes(p)) next.push(p)
    setNewPath("")
    setShowPathEditor(false)
    patch({ allowWrite: next }, "paths", language.t("settings.sandbox.paths.addFailed"))
  }
  const removePath = (p: string) =>
    patch(
      { allowWrite: (config().allowWrite ?? []).filter((x) => x !== p) },
      "paths",
      language.t("settings.sandbox.paths.removeFailed"),
    )

  return (
    <PanelScroll>
      <div
        class="settings-preferences-panel settings-preferences-panel--sandbox"
        aria-busy={saving() ? "true" : undefined}
      >
        <PanelHeader
          title={language.t("settings.sandbox.title")}
          description={language.t("settings.sandbox.description")}
        />
        <PanelBody>
          <Show when={data.error}>
            <div class="settings-alert" data-tone="critical" role="alert">
              <span>{language.t("settings.sandbox.error", { error: String(data.error) })}</span>
              <Button
                size="small"
                variant="secondary"
                class="settings-panel-action"
                disabled={data.loading || saving()}
                onClick={() => void refetch()}
              >
                {language.t("settings.sandbox.retry")}
              </Button>
            </div>
          </Show>
          <Show
            when={!data.loading && !data.error}
            fallback={
              <Show when={data.loading}>
                <div
                  class="settings-panel-loading__rows"
                  role="status"
                  aria-label={language.t("settings.sandbox.loading")}
                >
                  <span />
                  <span />
                  <span />
                </div>
              </Show>
            }
          >
            <Section
              title={language.t("settings.sandbox.protection.title")}
              description={language.t("settings.sandbox.protection.description")}
              action={
                <span class="settings-sandbox-save-state" role="status" aria-live="polite">
                  {saving() ? language.t("settings.sandbox.saving") : ""}
                </span>
              }
            >
              <div class="settings-card settings-preferences-card">
                <div class="settings-row settings-sandbox-control-row settings-sandbox-enable-row">
                  <div class="settings-row-copy">
                    <strong>{language.t("settings.sandbox.enable.title")}</strong>
                    <span>
                      {config().enabled !== false
                        ? language.t("settings.sandbox.enable.on")
                        : language.t("settings.sandbox.enable.off")}
                    </span>
                  </div>
                  <Switch
                    hideLabel
                    checked={config().enabled !== false}
                    disabled={busy("enabled") || unavailable()}
                    onChange={(checked) =>
                      patch({ enabled: checked }, "enabled", language.t("settings.sandbox.enableFailed"))
                    }
                  >
                    {language.t("settings.sandbox.enable.title")}
                  </Switch>
                </div>
                <Show
                  when={status()}
                  fallback={
                    <div
                      class="settings-panel-loading__rows"
                      role="status"
                      aria-label={language.t("settings.sandbox.checking")}
                    >
                      <span />
                    </div>
                  }
                >
                  {(s) => (
                    <>
                      <button
                        type="button"
                        class="settings-row settings-sandbox-status-row"
                        aria-expanded={showBackendDetails()}
                        aria-controls={backendDetailsId}
                        onClick={() => setShowBackendDetails((value) => !value)}
                      >
                        <span
                          class="settings-sandbox-status-mark"
                          data-tone={s().available ? "success" : "warning"}
                          aria-hidden="true"
                        >
                          <Icon name={s().available ? "check" : "stop"} size="small" />
                        </span>
                        <span class="settings-row-copy">
                          <strong>
                            {s().available
                              ? language.t("settings.sandbox.available.title")
                              : language.t("settings.sandbox.unavailable.title")}
                          </strong>
                          <span>
                            {s().available
                              ? language.t("settings.sandbox.available.backend", {
                                  backend: s().backend,
                                  platform: s().platform,
                                })
                              : language.t("settings.sandbox.unavailable.backend", {
                                  platform: s().platform,
                                })}
                          </span>
                        </span>
                        <span class="settings-preference-status" data-tone={s().available ? "success" : "warning"}>
                          {language.t(s().available ? "settings.sandbox.available" : "settings.sandbox.unavailable")}
                        </span>
                        <Icon
                          name="chevron-down"
                          size="small"
                          class="settings-sandbox-disclosure-icon"
                          classList={{ "settings-sandbox-disclosure-icon--open": showBackendDetails() }}
                        />
                      </button>
                      <Show when={showBackendDetails()}>
                        <div id={backendDetailsId} class="settings-sandbox-backend-details">
                          <dl>
                            <div>
                              <dt>{language.t("settings.sandbox.backend")}</dt>
                              <dd>{s().backend}</dd>
                            </div>
                            <div>
                              <dt>{language.t("settings.sandbox.platform")}</dt>
                              <dd>{s().platform}</dd>
                            </div>
                            <div>
                              <dt>{language.t("settings.sandbox.tool")}</dt>
                              <dd>{s().tool ?? language.t("settings.sandbox.notAvailable")}</dd>
                            </div>
                            <div>
                              <dt>{language.t("settings.sandbox.fileAccess")}</dt>
                              <dd>
                                {grantOnlyEnforced()
                                  ? language.t("settings.sandbox.fileAccess.grantOnly")
                                  : language.t("settings.sandbox.fileAccess.unavailable")}
                              </dd>
                            </div>
                            <div>
                              <dt>{language.t("settings.sandbox.network")}</dt>
                              <dd>
                                {networkDenyEnforced()
                                  ? language.t("settings.sandbox.network.denied")
                                  : language.t("settings.sandbox.network.unavailable")}
                              </dd>
                            </div>
                            <Show when={s().reason}>
                              <div>
                                <dt>{language.t("settings.sandbox.reason")}</dt>
                                <dd>{s().reason}</dd>
                              </div>
                            </Show>
                          </dl>
                        </div>
                      </Show>
                    </>
                  )}
                </Show>
              </div>
            </Section>

            <Show when={config().enabled !== false}>
              <Section
                title={language.t("settings.sandbox.policy.title")}
                description={language.t("settings.sandbox.policy.description")}
              >
                <div class="settings-card settings-preferences-card">
                  <div class="settings-row settings-sandbox-control-row">
                    <div class="settings-row-copy">
                      <strong>{language.t("settings.sandbox.trust.title")}</strong>
                      <span>
                        {config().requireProjectTrust === true
                          ? language.t("settings.sandbox.trust.on")
                          : language.t("settings.sandbox.trust.off")}
                      </span>
                    </div>
                    <Switch
                      hideLabel
                      checked={config().requireProjectTrust === true}
                      disabled={busy("trust") || unavailable()}
                      onChange={(checked) =>
                        patch({ requireProjectTrust: checked }, "trust", language.t("settings.sandbox.trustFailed"))
                      }
                    >
                      {language.t("settings.sandbox.trust.title")}
                    </Switch>
                  </div>

                  <div class="settings-row settings-sandbox-control-row">
                    <div class="settings-row-copy">
                      <strong>{language.t("settings.sandbox.networkAccess.title")}</strong>
                      <span>
                        {networkDenyEnforced()
                          ? language.t("settings.sandbox.networkAccess.denied")
                          : language.t("settings.sandbox.networkAccess.allow")}
                      </span>
                    </div>
                    <Select
                      aria-label={language.t("settings.sandbox.networkAccess.title")}
                      options={NETWORK_OPTS}
                      current={NETWORK_OPTS.find((o) => o.value === effectiveNetwork())}
                      value={(o) => o.value}
                      label={(o) => language.t(o.labelKey)}
                      disabled={busy("network") || unavailable() || networkDenyEnforced()}
                      onSelect={(o) =>
                        o && patch({ network: o.value }, "network", language.t("settings.sandbox.networkFailed"))
                      }
                      variant="secondary"
                      size="small"
                      triggerVariant="settings"
                    />
                  </div>

                  <div class="settings-row settings-sandbox-control-row">
                    <div class="settings-row-copy">
                      <strong>{language.t("settings.sandbox.fallback.title")}</strong>
                      <span>{language.t("settings.sandbox.fallback.description")}</span>
                    </div>
                    <Select
                      aria-label={language.t("settings.sandbox.fallback.title")}
                      options={UNAVAILABLE_OPTS}
                      current={UNAVAILABLE_OPTS.find((o) => o.value === (config().onUnavailable ?? "error"))}
                      value={(o) => o.value}
                      label={(o) => language.t(o.labelKey)}
                      disabled={busy("fallback") || unavailable()}
                      onSelect={(o) =>
                        o &&
                        patch({ onUnavailable: o.value }, "fallback", language.t("settings.sandbox.fallbackFailed"))
                      }
                      variant="secondary"
                      size="small"
                      triggerVariant="settings"
                    />
                  </div>
                </div>
              </Section>

              <Section
                title={language.t("settings.sandbox.paths.title")}
                count={(config().allowWrite ?? []).length}
                description={language.t("settings.sandbox.paths.description")}
              >
                <div class="settings-card settings-preferences-card">
                  <Show
                    when={(config().allowWrite ?? []).length > 0}
                    fallback={
                      <div class="settings-row settings-sandbox-control-row settings-sandbox-empty-paths">
                        <div class="settings-row-copy">
                          <strong>{language.t("settings.sandbox.paths.empty")}</strong>
                          <span>{language.t("settings.sandbox.paths.emptyDetail")}</span>
                        </div>
                        <button
                          type="button"
                          class="settings-preference-action"
                          aria-expanded={showPathEditor()}
                          aria-controls={pathEditorId}
                          disabled={busy("paths") || unavailable()}
                          onClick={() => setShowPathEditor((value) => !value)}
                        >
                          {language.t(
                            showPathEditor() ? "settings.sandbox.paths.cancel" : "settings.sandbox.paths.add",
                          )}
                        </button>
                      </div>
                    }
                  >
                    <For each={config().allowWrite ?? []}>
                      {(p) => (
                        <div class="settings-row settings-sandbox-path-row">
                          <code title={p}>{p}</code>
                          <button
                            type="button"
                            class="settings-preference-action"
                            data-variant="danger"
                            disabled={busy("paths")}
                            aria-label={language.t("settings.sandbox.paths.removeAria", { path: p })}
                            onClick={() => removePath(p)}
                          >
                            {language.t("settings.sandbox.paths.remove")}
                          </button>
                        </div>
                      )}
                    </For>
                  </Show>
                  <Show when={showPathEditor() || (config().allowWrite ?? []).length > 0}>
                    <div id={pathEditorId} class="settings-sandbox-path-editor">
                      <input
                        class="settings-field"
                        aria-label={language.t("settings.sandbox.paths.input")}
                        placeholder="/absolute/path"
                        value={newPath()}
                        disabled={busy("paths") || unavailable()}
                        onInput={(e) => setNewPath(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === "Enter" && addPath()}
                      />
                      <Button
                        class="settings-panel-action settings-panel-action--quiet"
                        size="small"
                        variant="secondary"
                        disabled={busy("paths") || unavailable() || !newPath().trim()}
                        onClick={addPath}
                      >
                        {language.t("settings.sandbox.paths.addButton")}
                      </Button>
                    </div>
                  </Show>
                </div>
              </Section>

              <Section
                title={language.t("settings.sandbox.test.title")}
                description={language.t("settings.sandbox.test.description")}
              >
                <div class="settings-card settings-preferences-card">
                  <div class="settings-row settings-sandbox-control-row settings-sandbox-test-row">
                    <div class="settings-row-copy">
                      <strong>{language.t("settings.sandbox.test.verify")}</strong>
                      <span>{language.t("settings.sandbox.test.verifyDetail")}</span>
                    </div>
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={testing() || unavailable() || !status()?.available}
                      onClick={runTest}
                    >
                      {testing()
                        ? language.t("settings.sandbox.test.testing")
                        : language.t("settings.sandbox.test.run")}
                    </Button>
                  </div>
                  <Show when={test()}>
                    {(t) => (
                      <div class="settings-sandbox-result" aria-live="polite">
                        <div class="settings-sandbox-result__summary" role="status">
                          <span class="settings-sandbox-result__dot" data-tone={t().ok ? "success" : "danger"} />
                          <span classList={{ "text-text-success": t().ok, "text-text-danger": !t().ok }}>
                            {language.t(t().ok ? "settings.sandbox.test.verified" : "settings.sandbox.test.failed")}
                          </span>
                          <button
                            type="button"
                            class="settings-preference-action"
                            data-variant="quiet"
                            aria-expanded={showTestDetails()}
                            aria-controls={testDetailsId}
                            onClick={() => setShowTestDetails((value) => !value)}
                          >
                            {showTestDetails()
                              ? language.t("settings.sandbox.test.hide")
                              : language.t("settings.sandbox.test.show", { count: t().checks.length })}
                          </button>
                        </div>
                        <Show when={showTestDetails()}>
                          <div id={testDetailsId} class="settings-sandbox-checks">
                            <For each={t().checks}>
                              {(c) => (
                                <div class="settings-sandbox-check">
                                  <Icon
                                    name={c.skipped ? "dash" : c.pass ? "check" : "close"}
                                    class={
                                      c.skipped ? "text-text-weak" : c.pass ? "text-text-success" : "text-text-danger"
                                    }
                                    size="small"
                                  />
                                  <span>{c.name}</span>
                                  <Show when={c.detail}>
                                    <code class="settings-sandbox-check__detail">{c.detail}</code>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              </Section>
            </Show>
          </Show>
        </PanelBody>
      </div>
    </PanelScroll>
  )
}

export default Sandbox
