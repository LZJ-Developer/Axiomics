import { Show, type ParentProps } from "solid-js"
import { useLocation, useParams } from "@solidjs/router"
import { MarkedProvider } from "@axiomics/ui/context/marked"
import { DiffComponentProvider } from "@axiomics/ui/context/diff"
import { CodeComponentProvider } from "@axiomics/ui/context/code"
import { Diff } from "@axiomics/ui/diff"
import { Code } from "@axiomics/ui/code"
import { usePlatform } from "@/context/platform"
// Side effect: registers the inline science-artifact tool renderer before the
// session page can dispatch a `metadata.artifact` envelope.
import "@/science/tool-renderer"
import SessionPage from "./session"

export function SessionRenderProviders(props: ParentProps) {
  const platform = usePlatform()
  return (
    <MarkedProvider nativeParser={platform.parseMarkdown}>
      <DiffComponentProvider component={Diff}>
        <CodeComponentProvider component={Code}>{props.children}</CodeComponentProvider>
      </DiffComponentProvider>
    </MarkedProvider>
  )
}

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
