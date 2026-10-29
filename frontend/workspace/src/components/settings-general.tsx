import { Component, For, Show, createMemo, onCleanup, type JSX } from "solid-js"
import { Button } from "@axiomics/ui/button"
import { Select } from "@axiomics/ui/select"
import { Switch } from "@axiomics/ui/switch"
import { useTheme, type ColorScheme } from "@axiomics/ui/theme"
import { showToast } from "@axiomics/ui/toast"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { playSound, SOUND_OPTIONS } from "@/utils/sound"
import { PanelBody, PanelHeader, PanelScroll, Section as SettingsSection } from "./settings/_shared"
import "./settings-general.css"

let demoSoundState = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
}

// To prevent audio from overlapping/playing very quickly when navigating the settings menus,
// delay the playback by 100ms during quick selection changes and pause existing sounds.
const playDemoSound = (src: string, volume: number) => {
  if (demoSoundState.cleanup) {
    demoSoundState.cleanup()
  }

  clearTimeout(demoSoundState.timeout)

  demoSoundState.timeout = setTimeout(() => {
    demoSoundState.cleanup = playSound(src, volume)
  }, 100)
}

// The appearance / notification / sound / update controls, without any
// outer scroll wrapper or header — so the new General settings panel can compose
// them below its Account / Model / Licensing sections. `SettingsGeneral` below
// keeps the standalone panel (scroll + header) for any legacy mount.
export const AppearanceSections: Component = () => {
  const theme = useTheme()
  const language = useLanguage()
  const settings = useSettings()

  onCleanup(() => {
    clearTimeout(demoSoundState.timeout)
    demoSoundState.cleanup?.()
    demoSoundState = { cleanup: undefined, timeout: undefined }
  })

  const languageOptions = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )

  const colorSchemeOptions = createMemo((): { value: ColorScheme; label: string }[] => [
    { value: "system", label: language.t("theme.scheme.system") },
    { value: "light", label: language.t("theme.scheme.light") },
    { value: "dark", label: language.t("theme.scheme.dark") },
  ])

  const themeOptions = createMemo(() =>
    Object.values(theme.themes())
      .map((item) => ({ value: item.id, label: item.name }))
      .sort((a, b) => (a.value === "axiomics" ? -1 : b.value === "axiomics" ? 1 : a.label.localeCompare(b.label))),
  )

  const soundOptions = [...SOUND_OPTIONS]

  return (
    <>
      <SettingsSection title={language.t("settings.general.section.appearance")}>
        <div class="settings-card">
          <SettingsRow
            title={language.t("settings.theme.title")}
            description={language.t("settings.theme.description")}
          >
            <Select
              aria-label={language.t("settings.theme.title")}
              options={themeOptions()}
              current={themeOptions().find((option) => option.value === theme.themeId())}
              value={(option) => option.value}
              label={(option) => option.label}
              onSelect={(option) => option && theme.setTheme(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.appearance.title")}
            description={language.t("settings.general.row.appearance.description")}
          >
            <div
              role="group"
              aria-label={language.t("settings.general.row.appearance.title")}
              class="settings-segmented-control"
            >
              <For each={colorSchemeOptions()}>
                {(option) => (
                  <button
                    type="button"
                    aria-pressed={theme.colorScheme() === option.value}
                    class="settings-segmented-control__option"
                    data-selected={theme.colorScheme() === option.value ? "true" : undefined}
                    onClick={() => theme.setColorScheme(option.value)}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.row.language.title")}
            description={language.t("settings.general.row.language.description")}
          >
            <Select
              aria-label={language.t("settings.general.row.language.title")}
              options={languageOptions()}
              current={languageOptions().find((o) => o.value === language.locale())}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(option) => option && language.setLocale(option.value)}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
        </div>
      </SettingsSection>

      <SettingsSection title={language.t("settings.general.section.notifications")}>
        <div class="settings-card">
          <SettingsRow
            title={language.t("settings.general.notifications.agent.title")}
            description={language.t("settings.general.notifications.agent.description")}
          >
            <Switch
              hideLabel
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            >
              {language.t("settings.general.notifications.agent.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.notifications.permissions.title")}
            description={language.t("settings.general.notifications.permissions.description")}
          >
            <Switch
              hideLabel
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            >
              {language.t("settings.general.notifications.permissions.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.notifications.errors.title")}
            description={language.t("settings.general.notifications.errors.description")}
          >
            <Switch
              hideLabel
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            >
              {language.t("settings.general.notifications.errors.title")}
            </Switch>
          </SettingsRow>
        </div>
      </SettingsSection>

      <SettingsSection title={language.t("settings.general.section.sounds")}>
        <div class="settings-card">
          <SettingsRow
            title={language.t("settings.general.sounds.enabled.title")}
            description={language.t("settings.general.sounds.enabled.description")}
          >
            <Switch
              hideLabel
              checked={settings.sounds.enabled()}
              onChange={(checked) => settings.sounds.setEnabled(checked)}
            >
              {language.t("settings.general.sounds.enabled.title")}
            </Switch>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.sounds.volume.title")}
            description={language.t("settings.general.sounds.volume.description")}
          >
            <label class="settings-sound-volume">
              <span class="sr-only">{language.t("settings.general.sounds.volume.title")}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.sounds.volume()}
                disabled={!settings.sounds.enabled()}
                aria-valuetext={`${Math.round(settings.sounds.volume() * 100)}%`}
                onInput={(event) => settings.sounds.setVolume(Number(event.currentTarget.value))}
              />
              <output aria-live="polite">{Math.round(settings.sounds.volume() * 100)}%</output>
            </label>
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.sounds.agent.title")}
            description={language.t("settings.general.sounds.agent.description")}
          >
            <Select
              aria-label={language.t("settings.general.sounds.agent.title")}
              disabled={!settings.sounds.enabled()}
              options={soundOptions}
              current={soundOptions.find((o) => o.id === settings.sounds.agent())}
              value={(o) => o.id}
              label={(o) => language.t(o.label)}
              onSelect={(option) => {
                if (!option) return
                settings.sounds.setAgent(option.id)
                playDemoSound(option.src, settings.sounds.volume())
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.sounds.permissions.title")}
            description={language.t("settings.general.sounds.permissions.description")}
          >
            <Select
              aria-label={language.t("settings.general.sounds.permissions.title")}
              disabled={!settings.sounds.enabled()}
              options={soundOptions}
              current={soundOptions.find((o) => o.id === settings.sounds.permissions())}
              value={(o) => o.id}
              label={(o) => language.t(o.label)}
              onSelect={(option) => {
                if (!option) return
                settings.sounds.setPermissions(option.id)
                playDemoSound(option.src, settings.sounds.volume())
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>

          <SettingsRow
            title={language.t("settings.general.sounds.errors.title")}
            description={language.t("settings.general.sounds.errors.description")}
          >
            <Select
              aria-label={language.t("settings.general.sounds.errors.title")}
              disabled={!settings.sounds.enabled()}
              options={soundOptions}
              current={soundOptions.find((o) => o.id === settings.sounds.errors())}
              value={(o) => o.id}
              label={(o) => language.t(o.label)}
              onSelect={(option) => {
                if (!option) return
                settings.sounds.setErrors(option.id)
                playDemoSound(option.src, settings.sounds.volume())
              }}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </SettingsRow>
        </div>
      </SettingsSection>
    </>
  )
}

// Standalone General appearance panel (scroll + header). Retained for any legacy
// mount; the primary General settings panel composes AppearanceSections directly.
export const SettingsGeneral: Component = () => {
  const language = useLanguage()
  return (
    <PanelScroll>
      <PanelHeader title={language.t("settings.tab.general")} description="Appearance, notifications, and updates." />
      <PanelBody>
        <AppearanceSections />
      </PanelBody>
    </PanelScroll>
  )
}

interface SettingsRowProps {
  title: string
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="settings-row justify-between">
      <div class="flex min-w-0 flex-1 basis-[220px] flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="ml-auto max-w-full flex-shrink-0">{props.children}</div>
    </div>
  )
}
