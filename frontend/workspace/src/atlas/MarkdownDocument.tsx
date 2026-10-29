import { createMemo, For, Show, type ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { Markdown } from "@axiomics/ui/markdown"
import { Popover } from "@axiomics/ui/popover"
import { englishT, type Translate } from "../i18n/fallback"
import { splitAlignedMarkdown } from "./FilePreviewMarkdown"
import {
  documentDefaults,
  readDocumentPreferences,
  writeDocumentPreferences,
  type DocumentPreferences,
} from "./document-preferences"
import "./FilePreview.css"

/** Document-only presentation. Source bytes, sanitization and authorized
 * image/file resolution remain the shared Markdown renderer's responsibility. */
export function MarkdownDocument(
  props: Pick<ComponentProps<typeof Markdown>, "text" | "resolveImage" | "resolveFile" | "onOpenFile"> & {
    name?: string
    /** Translator for embeds that render outside the LanguageProvider. */
    t?: Translate
  },
) {
  const t = () => props.t ?? englishT
  const [reading, setReading] = createStore(readDocumentPreferences())
  const markdown = createMemo(() => splitAlignedMarkdown(props.text))
  const change = (next: Partial<DocumentPreferences>) => {
    setReading(next)
    writeDocumentPreferences({ ...reading })
  }
  const content = (text: string) => (
    <Markdown
      class="atlas-md"
      text={text}
      resolveImage={props.resolveImage}
      resolveFile={props.resolveFile}
      onOpenFile={props.onOpenFile}
    />
  )

  return (
    <article
      class="atlas-file-document atlas-markdown-document"
      aria-label={
        props.name ? t()("files.document.namedPreview", { name: props.name }) : t()("files.document.markdownPreview")
      }
      data-reading-font={reading.font}
      data-reading-width={reading.width}
      style={{ "--document-font-size": `${reading.size}px` }}
    >
      <div class="atlas-document-tools">
        <Popover
          title={t()("files.document.readingOptions")}
          description={t()("files.document.readingOptionsDescription")}
          placement="bottom-end"
          class="atlas-reading-options"
          triggerAs="button"
          triggerProps={{
            type: "button",
            class: "atlas-file-button atlas-reading-trigger",
            "aria-label": t()("files.document.readingOptions"),
            title: t()("files.document.readingOptions"),
          }}
          trigger={<span aria-hidden="true">Aa</span>}
        >
          <fieldset>
            <legend>{t()("files.document.textSize")}</legend>
            <div class="atlas-reading-choices" role="group" aria-label={t()("files.document.textSizeGroup")}>
              <For each={[13, 15, 17, 19]}>
                {(size) => (
                  <button
                    type="button"
                    aria-label={t()("files.document.pixels", { size })}
                    aria-pressed={reading.size === size}
                    onClick={() => change({ size })}
                  >
                    {size}
                  </button>
                )}
              </For>
            </div>
          </fieldset>
          <fieldset>
            <legend>{t()("files.document.typeface")}</legend>
            <div class="atlas-reading-choices" role="group" aria-label={t()("files.document.typefaceGroup")}>
              <button type="button" aria-pressed={reading.font === "sans"} onClick={() => change({ font: "sans" })}>
                {t()("files.document.sans")}
              </button>
              <button type="button" aria-pressed={reading.font === "serif"} onClick={() => change({ font: "serif" })}>
                {t()("files.document.serif")}
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>{t()("files.document.pageWidth")}</legend>
            <div class="atlas-reading-choices" role="group" aria-label={t()("files.document.pageWidthGroup")}>
              <button
                type="button"
                aria-pressed={reading.width === "readable"}
                onClick={() => change({ width: "readable" })}
              >
                {t()("files.document.readable")}
              </button>
              <button type="button" aria-pressed={reading.width === "full"} onClick={() => change({ width: "full" })}>
                {t()("files.document.fullWidth")}
              </button>
            </div>
          </fieldset>
          <button type="button" class="atlas-reading-reset" onClick={() => change(documentDefaults)}>
            {t()("files.document.reset")}
          </button>
        </Popover>
      </div>
      <Show when={markdown().lead} fallback={content(props.text)}>
        {(lead) => (
          <div class="atlas-file-document-lead" data-align={lead().alignment}>
            {content(lead().text)}
          </div>
        )}
      </Show>
      <Show when={markdown().lead && markdown().rest}>{(rest) => content(rest())}</Show>
    </article>
  )
}
