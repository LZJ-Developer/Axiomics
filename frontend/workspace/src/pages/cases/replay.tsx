import { useNavigate, useParams } from "@solidjs/router"
import { createResource, onCleanup, Show } from "solid-js"
import { useData } from "@axiomics/ui/context/data"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { ReplayPlayer } from "./player"
import { timeline } from "./timeline"
import "./cases.css"

/**
 * Workbench replay: fetch the session through the tenant API, then hand the
 * immutable result to the shared read-only player. The public cases entry uses
 * the same player with a static fixture instead of the SDK.
 */
export default function CaseReplay(props: { sessionID: string }) {
  const sdk = useSDK()
  return (
    <Show when={`${sdk.scope}/${props.sessionID}`} keyed>
      {(key) => <Recording key={key} />}
    </Show>
  )

  function Recording(input: { key: string }) {
    const params = useParams()
    const navigate = useNavigate()
    const data = useData()
    const language = useLanguage()
    const abort = new AbortController()
    onCleanup(() => abort.abort())
    const [recording, actions] = createResource(
      () => input.key,
      async () => {
        const results = await Promise.all([
          sdk.client.session.get({ sessionID: props.sessionID }, { signal: abort.signal }),
          sdk.client.session.messages({ sessionID: props.sessionID }, { signal: abort.signal }),
        ])
        const session = results[0].data
        const messages = results[1].data
        if (!session || !messages) throw new Error(language.t("cases.replay.unavailable"))
        return { session, messages, frames: timeline(messages, session.revert?.messageID) }
      },
    )
    return (
      <>
        <Show when={recording.loading}>
          <p class="case-replay-status" role="status">
            {language.t("cases.replay.loading")}
          </p>
        </Show>
        <Show when={recording.error}>
          <div class="case-replay-status" role="alert">
            <span>{language.t("cases.replay.error")}</span>
            <button type="button" onClick={() => actions.refetch()}>
              {language.t("cases.retry")}
            </button>
          </div>
        </Show>
        <Show when={!recording.loading && recording()} keyed>
          {(recorded) => (
            <ReplayPlayer
              session={recorded.session}
              messages={recorded.messages}
              frames={recorded.frames}
              directory={sdk.directory}
              onOpenFile={data.openFile}
              onOpenArtifact={data.openArtifact}
              onResolveMedia={data.mediaUrl}
              onNavigateToSession={(id) => navigate(`/${params.dir}/session/${id}?replay=1`)}
            />
          )}
        </Show>
      </>
    )
  }
}
