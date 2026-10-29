import { createMemo, createResource, createSignal, onCleanup, type JSX } from "solid-js"
import { useSDK } from "@/context/sdk"
import { hostReading, type Capacity } from "@/atlas/host-instruments"
import { identify } from "@/atlas/poll-identity"
import { createKernelRouteRequester, kernelAPI } from "@/atlas/kernel-api"
import { IconCpu } from "@/atlas/shared/Icon"
import { englishT, type Translate } from "@/i18n/fallback"
import "@/atlas/HostStrip.css"

type HostStripProps = {
  request?: (path: string) => Promise<Response>
  /** Translator for the standalone test seam (no LanguageProvider). */
  t?: Translate
}

export function HostStrip(props: HostStripProps = {}): JSX.Element {
  const t = () => props.t ?? englishT
  const request = props.request ?? useSDK().request
  const kernelRequest = createKernelRouteRequester(request)
  const client = identify()
  const [health, setHealth] = createSignal<"loading" | "available" | "unavailable">("loading")
  const load = () =>
    kernelRequest(kernelAPI.compute(client))
      .then((response) => (response.ok ? (response.json() as Promise<Capacity>) : undefined))
      .then((capacity) => {
        setHealth(capacity ? "available" : "unavailable")
        return capacity
      })
      .catch(() => {
        setHealth("unavailable")
        return undefined
      })
  const [data, api] = createResource(load)
  const reading = createMemo(() => hostReading(data.latest))
  const memoryTotal = createMemo(() =>
    reading().memory === "memory unavailable"
      ? reading().memory
      : reading()
          .memory.replace(/^of /, "/ ")
          .replace(/ memory$/, ""),
  )
  const refresh = () => {
    if (document.hidden || data.loading) return
    void api.refetch()
  }
  const timer = setInterval(refresh, 2_500)
  document.addEventListener("visibilitychange", refresh)
  onCleanup(() => {
    clearInterval(timer)
    document.removeEventListener("visibilitychange", refresh)
  })

  return (
    <section
      class="host-strip"
      aria-label={t()("compute.host.current")}
      data-testid="host-strip"
      data-health={health()}
    >
      <div class="host-strip__identity">
        <span class="host-strip__glyph" aria-hidden="true">
          <IconCpu size={16} strokeWidth={1.5} />
        </span>
        <div class="host-strip__copy">
          <strong>{t()("compute.host.title")}</strong>
          <span>
            {health() === "loading"
              ? t()("compute.host.loading")
              : health() === "unavailable"
                ? t()("compute.host.unavailable")
                : t()("compute.host.active", { live: reading().live, running: reading().running })}
          </span>
        </div>
      </div>

      <div class="host-strip__resources" aria-label={t()("compute.host.resources")}>
        <div class="host-strip__metric" data-host-tile="memory">
          <span class="host-strip__label">{t()("compute.host.memory")}</span>
          <p>
            <strong class="host-strip__headline">{reading().headline}</strong>
            <span class="host-strip__total">{memoryTotal()}</span>
          </p>
          <Meter value={reading().memoryFill} />
        </div>
        <div class="host-strip__metric" data-host-tile="cpu">
          <span class="host-strip__label">{t()("compute.host.cpu")}</span>
          <p>
            <strong class="host-strip__cores-value">{reading().cores}</strong>
            <span class="host-strip__total">{t()("compute.host.cores")}</span>
          </p>
          <Meter value={reading().cpuFill} />
        </div>
      </div>
      <span class="host-strip__health" aria-live="polite" aria-label={health()} />
    </section>
  )
}

function Meter(props: { value: number }): JSX.Element {
  return (
    <span class="host-strip__meter" role="presentation" aria-hidden="true">
      <i style={{ width: `${Math.round(props.value * 100)}%` }} />
    </span>
  )
}
