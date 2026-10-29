// Permissions — the standing approvals granted from permission cards (project
// and machine scope, revocable here) plus the per-tool allow/ask/deny defaults
// the agent loop enforces (config `permission` key via the globalSync-backed
// component).
//
// The former "Registry actions" grant grid was removed deliberately: it
// persisted scopes to a JSON store that no backend path ever consulted, so the
// controls were display-only. Per the product truth pass, surfaces without a
// real end-to-end runtime path are removed rather than shown.
import { Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useParams } from "@solidjs/router"
import { Button } from "@axiomics/ui/button"
import { Icon } from "@axiomics/ui/icon"
import { useDialog } from "@axiomics/ui/context/dialog"
import { showToast } from "@axiomics/ui/toast"
import { confirmDialog } from "@/atlas/dialogs"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { resolveProjectRoute } from "@/utils/project-route"
import { PermissionToolDefaults } from "../settings-permissions"
import { PanelBody, PanelHeader, PanelScroll, Section } from "./_shared"
import "./preference-panels.css"

interface StandingApproval {
  id: string
  permission: string
  pattern: string
  scope: "project" | "global"
  created: number
}

interface FolderGrant {
  id: string
  path: string
  access: "read" | "write"
  scope: "once" | "session" | "project" | "installation"
  source: "permission" | "api"
  time: { created: number }
}

const Permissions: Component = () => {
  const params = useParams()
  const sdk = useGlobalSDK()
  const globalSync = useGlobalSync()
  const dialog = useDialog()
  const language = useLanguage()
  const [busy, setBusy] = createSignal(false)
  const [showAllDefaults, setShowAllDefaults] = createSignal(false)

  const route = createMemo(() => resolveProjectRoute(params.dir, globalSync.data.project))

  const [standing, { refetch }] = createResource(
    () => route()?.directory ?? false,
    async (directory) => {
      const response = await sdk.client.permission.standing.list({ directory })
      return (response.data ?? []) as StandingApproval[]
    },
  )

  const [trust, trustControls] = createResource(
    () => {
      const value = route()
      if (!value) return
      return { projectID: value.projectID, directory: value.directory }
    },
    async (input) => {
      const response = await sdk.client.project.trust.get(input)
      if (!response.data) throw new Error("Project trust status was empty.")
      return response.data
    },
  )

  const [folders, folderControls] = createResource(
    () => {
      const value = route()
      const sessionID = params.id
      if (!value || !sessionID || sessionID === "new") return
      return { sessionID, directory: value.directory }
    },
    async (input) => {
      const response = await sdk.client.session.filesystem.list(input)
      return (response.data?.grants ?? []).filter(
        (grant): grant is FolderGrant =>
          (grant.source === "permission" || grant.source === "api") && !grant.time.consumed && !grant.time.revoked,
      )
    },
  )

  const revoke = async (approval: StandingApproval) => {
    const directory = route()?.directory
    if (!directory) return
    setBusy(true)
    try {
      await sdk.client.permission.standing.revoke({ id: approval.id, directory })
      await refetch()
    } catch (err) {
      showToast({
        title: language.t("settings.permissions.standing.revokeFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const when = (created: number) => new Date(created).toLocaleDateString()

  const revokeFolder = async (grant: FolderGrant) => {
    const value = route()
    const sessionID = params.id
    if (!value || !sessionID || busy()) return
    const confirmed = await confirmDialog(dialog, {
      title: language.t("settings.permissions.folders.revokeTitle", { path: grant.path }),
      message: language.t("settings.permissions.folders.revokeMessage"),
      confirmLabel: language.t("settings.permissions.folders.revokeConfirm"),
      danger: true,
    })
    if (!confirmed) return
    setBusy(true)
    await sdk.client.session.filesystem
      .revoke({ sessionID, grantID: grant.id, directory: value.directory })
      .then(() => folderControls.refetch())
      .catch((error) =>
        showToast({
          title: language.t("settings.permissions.folders.revokeFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setBusy(false))
  }

  const updateTrust = async (trusted: boolean) => {
    const value = route()
    const status = trust()
    if (!value || !status || busy()) return
    const confirmed = await confirmDialog(dialog, {
      title: language.t(trusted ? "settings.permissions.trust.question" : "settings.permissions.trust.revokeQuestion"),
      message: trusted
        ? language.t("settings.permissions.trust.message", { root: status.root })
        : language.t("settings.permissions.trust.revokeMessage"),
      confirmLabel: language.t(
        trusted ? "settings.permissions.trust.confirm" : "settings.permissions.trust.revokeConfirm",
      ),
      danger: !trusted,
    })
    if (!confirmed) return
    setBusy(true)
    try {
      await sdk.client.project.trust.update({
        projectID: value.projectID,
        directory: value.directory,
        body: trusted ? { trusted: true, root: status.root } : { trusted: false },
      })
      await trustControls.refetch()
      showToast({
        variant: "success",
        title: language.t(trusted ? "settings.permissions.toast.trusted" : "settings.permissions.toast.revoked"),
      })
    } catch (error) {
      showToast({
        title: language.t(
          trusted ? "settings.permissions.toast.trustFailed" : "settings.permissions.toast.revokeFailed",
        ),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <PanelScroll>
      <div class="settings-preferences-panel settings-preferences-panel--permissions">
        <PanelHeader
          title={language.t("settings.permissions.page.title")}
          description={language.t("settings.permissions.page.description")}
        />
        <PanelBody>
          <Show when={route()}>
            <Section
              title={language.t("settings.permissions.projectCode.title")}
              description={language.t("settings.permissions.projectCode.description")}
            >
              <div class="settings-card settings-preferences-card">
                <Show
                  when={!trust.loading}
                  fallback={
                    <div
                      class="settings-panel-loading__rows"
                      role="status"
                      aria-label={language.t("settings.permissions.projectCode.loading")}
                    >
                      <span />
                    </div>
                  }
                >
                  <Show
                    when={!trust.error}
                    fallback={
                      <div class="settings-alert" data-tone="critical" role="alert">
                        <span>
                          {language.t("settings.permissions.projectCode.error", {
                            error: String(trust.error),
                          })}
                        </span>
                        <Button
                          size="small"
                          variant="secondary"
                          class="settings-panel-action"
                          onClick={() => void trustControls.refetch()}
                        >
                          {language.t("settings.permissions.retry")}
                        </Button>
                      </div>
                    }
                  >
                    <div class="settings-row settings-preference-row justify-between">
                      <span
                        class="settings-preference-icon"
                        data-tone={trust()?.canExecuteProjectCode ? "success" : "warning"}
                        aria-hidden="true"
                      >
                        <Icon name={trust()?.canExecuteProjectCode ? "shield" : "shield-alert"} size="small" />
                      </span>
                      <div class="settings-row-copy">
                        <strong>
                          {language.t(
                            trust()?.canExecuteProjectCode
                              ? "settings.permissions.projectCode.enabled"
                              : "settings.permissions.projectCode.blocked",
                          )}
                        </strong>
                        <span class="text-11-regular text-text-weak break-all">{trust()?.root}</span>
                      </div>
                      <span
                        class="settings-preference-status"
                        data-tone={trust()?.canExecuteProjectCode ? "success" : "warning"}
                      >
                        {language.t(
                          trust()?.canExecuteProjectCode
                            ? "settings.permissions.projectCode.trusted"
                            : "settings.permissions.projectCode.restricted",
                        )}
                      </span>
                      <Button
                        size="small"
                        variant={trust()?.canExecuteProjectCode ? "ghost" : "secondary"}
                        disabled={busy() || !trust()}
                        onClick={() => void updateTrust(!trust()?.canExecuteProjectCode)}
                      >
                        {language.t(
                          trust()?.canExecuteProjectCode
                            ? "settings.permissions.projectCode.revoke"
                            : "settings.permissions.projectCode.trust",
                        )}
                      </Button>
                    </div>
                  </Show>
                </Show>
              </div>
            </Section>
          </Show>

          <Show when={route() && params.id && params.id !== "new"}>
            <Section
              title={language.t("settings.permissions.folders.title")}
              description={language.t("settings.permissions.folders.description")}
            >
              <div class="settings-card settings-preferences-card">
                <Show
                  when={!folders.loading}
                  fallback={
                    <div
                      class="settings-panel-loading__rows"
                      role="status"
                      aria-label={language.t("settings.permissions.folders.loading")}
                    >
                      <span />
                    </div>
                  }
                >
                  <Show
                    when={!folders.error}
                    fallback={
                      <div class="settings-alert" data-tone="critical" role="alert">
                        <span>{language.t("settings.permissions.folders.error")}</span>
                        <Button
                          size="small"
                          variant="secondary"
                          class="settings-panel-action"
                          onClick={() => void folderControls.refetch()}
                        >
                          {language.t("settings.permissions.retry")}
                        </Button>
                      </div>
                    }
                  >
                    <Show
                      when={(folders() ?? []).length > 0}
                      fallback={
                        <p class="settings-card-empty" role="status">
                          {language.t("settings.permissions.folders.empty")}
                        </p>
                      }
                    >
                      <For each={folders()}>
                        {(grant) => (
                          <div class="settings-row settings-preference-row justify-between">
                            <div class="settings-row-copy">
                              <strong class="break-all">{grant.path}</strong>
                              <span class="text-11-regular text-text-weak">
                                {language.t(
                                  grant.access === "write"
                                    ? "settings.permissions.access.write"
                                    : "settings.permissions.access.read",
                                )}{" "}
                                ·{" "}
                                {language.t(
                                  grant.scope === "installation"
                                    ? "settings.permissions.scope.everyProject"
                                    : grant.scope === "project"
                                      ? "settings.permissions.scope.thisProject"
                                      : "settings.permissions.scope.thisSession",
                                )}
                              </span>
                            </div>
                            <Button
                              size="small"
                              variant="ghost"
                              disabled={busy()}
                              onClick={() => void revokeFolder(grant)}
                            >
                              {language.t("settings.permissions.folders.revoke")}
                            </Button>
                          </div>
                        )}
                      </For>
                    </Show>
                  </Show>
                </Show>
              </div>
            </Section>
          </Show>

          {/* ── Standing approvals ── */}
          <Show when={route()}>
            <Section
              title={language.t("settings.permissions.standing.title")}
              description={language.t("settings.permissions.standing.description")}
            >
              <div class="settings-card settings-preferences-card">
                <Show
                  when={!standing.loading}
                  fallback={
                    <div
                      class="settings-panel-loading__rows"
                      role="status"
                      aria-label={language.t("settings.permissions.standing.loading")}
                    >
                      <span />
                      <span />
                    </div>
                  }
                >
                  <Show
                    when={!standing.error}
                    fallback={
                      <div class="settings-alert" data-tone="critical" role="alert">
                        <span>
                          {language.t("settings.permissions.standing.error", {
                            error: String(standing.error),
                          })}
                        </span>
                        <Button
                          size="small"
                          variant="secondary"
                          class="settings-panel-action"
                          disabled={standing.loading}
                          onClick={() => void refetch()}
                        >
                          {language.t("settings.permissions.retry")}
                        </Button>
                      </div>
                    }
                  >
                    <Show
                      when={(standing() ?? []).length > 0}
                      fallback={
                        <p class="settings-card-empty" role="status">
                          {language.t("settings.permissions.standing.empty")}
                        </p>
                      }
                    >
                      <For each={standing()}>
                        {(approval) => (
                          <div class="settings-row settings-preference-row justify-between">
                            <div class="settings-row-copy">
                              <strong class="break-all">
                                {approval.permission}
                                <Show when={approval.pattern !== "*"}>
                                  <span class="text-text-weak font-normal"> · {approval.pattern}</span>
                                </Show>
                              </strong>
                              <span class="text-11-regular text-text-weak">
                                {language.t(
                                  approval.scope === "global"
                                    ? "settings.permissions.standing.scopeEverywhere"
                                    : "settings.permissions.standing.scopeProject",
                                )}
                                {language.t("settings.permissions.standing.granted", {
                                  date: when(approval.created),
                                })}
                              </span>
                            </div>
                            <span class="ml-auto shrink-0">
                              <Button
                                size="small"
                                variant="ghost"
                                disabled={busy()}
                                onClick={() => void revoke(approval)}
                              >
                                {language.t("settings.permissions.standing.revoke")}
                              </Button>
                            </span>
                          </div>
                        )}
                      </For>
                    </Show>
                  </Show>
                </Show>
              </div>
            </Section>
          </Show>

          {/* Tool defaults are a long list, so keep the most common controls visible first. */}
          <div
            id="permission-tool-defaults"
            class="settings-permission-defaults settings-disclosure-group"
            data-expanded={showAllDefaults() ? "true" : "false"}
          >
            <PermissionToolDefaults />
            <div class="settings-disclosure-footer">
              <button
                type="button"
                class="settings-preference-action"
                data-variant="quiet"
                aria-expanded={showAllDefaults()}
                aria-controls="permission-tool-defaults"
                onClick={() => setShowAllDefaults((value) => !value)}
              >
                <Icon
                  name="chevron-down"
                  size="small"
                  classList={{ "rotate-180": showAllDefaults() }}
                  aria-hidden="true"
                />
                {showAllDefaults()
                  ? language.t("settings.permissions.defaults.showFewer")
                  : language.t("settings.permissions.defaults.showAll")}
              </button>
            </div>
          </div>
        </PanelBody>
      </div>
    </PanelScroll>
  )
}

export default Permissions
