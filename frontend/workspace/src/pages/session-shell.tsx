import { Show } from "solid-js"
import { useLocation, useParams } from "@solidjs/router"
import { SessionRenderProviders } from "./session-render-providers"
import SessionPage from "./session"

export { SessionRenderProviders }

export default function SessionShell() {
  const location = useLocation()
  const params = useParams()
  const replay = () => new URLSearchParams(location.search).get("replay") === "1"
  return (
    <SessionRenderProviders>
      <Show when={replay() && params.id} fallback={<SessionPage />} keyed>
        {(_id) => <SessionPage />}
      </Show>
    </SessionRenderProviders>
  )
}
