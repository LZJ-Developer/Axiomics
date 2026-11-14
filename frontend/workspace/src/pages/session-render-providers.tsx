import type { ParentProps } from "solid-js"
import { MarkedProvider } from "@axiomics/ui/context/marked"
import { DiffComponentProvider } from "@axiomics/ui/context/diff"
import { CodeComponentProvider } from "@axiomics/ui/context/code"
import { Diff } from "@axiomics/ui/diff"
import { Code } from "@axiomics/ui/code"
import { usePlatform } from "@/context/platform"
// Side effect: registers the inline science-artifact tool renderer before the
// session page can dispatch a `metadata.artifact` envelope. The public replay
// uses the same renderers, so this module is the shared boundary.
import "@/science/tool-renderer"

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
