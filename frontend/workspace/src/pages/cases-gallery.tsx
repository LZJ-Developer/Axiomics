import { A } from "@solidjs/router"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  IconBookOpen,
  IconResearch,
  IconSearch,
} from "@/atlas/shared/Icon"
import { Wordmark } from "@/atlas/Wordmark"
import { useLanguage } from "@/context/language"
import { cases, replay, select } from "./cases/catalog"
import "./cases/cases.css"

export default function CasesGallery() {
  const language = useLanguage()
  const [state, setState] = createStore({ query: "", filter: "all" })
  const groups = [...new Set(cases.map((item) => item.omics))]
  const filters = [...groups, ...new Set(cases.flatMap((item) => "series" in item ? [item.series] : []))]
  const tools = new Set(cases.flatMap((item) => item.tool.split(" + "))).size
  const shown = createMemo(() => select(state.query, state.filter))

  return (
    <main class="cases-shell">
      <aside class="cases-nav">
        <A class="cases-brand" href="/" aria-label="Axiomics">
          <Wordmark size="sm" />
        </A>
        <nav aria-label={language.t("cases.navigation")}>
          <A href="/">
            <IconResearch size={16} />
            {language.t("cases.new")}
          </A>
          <A href="/cases" aria-current="page">
            <IconBookOpen size={16} />
            {language.t("cases.title")}
          </A>
        </nav>
        <p>{language.t("cases.sidebarNote")}</p>
      </aside>

      <section class="cases-page" aria-labelledby="cases-title">
        <header class="cases-header">
          <div class="cases-heading">
            <span class="cases-eyebrow">{language.t("cases.eyebrow")}</span>
            <h1 id="cases-title">{language.t("cases.heading")}</h1>
            <p>{language.t("cases.description")}</p>
          </div>
          <dl class="cases-stats" aria-label={language.t("cases.summary")}>
            <div>
              <dt>{language.t("cases.count")}</dt>
              <dd>{cases.length}</dd>
            </div>
            <div>
              <dt>{language.t("cases.omics")}</dt>
              <dd>{groups.length}</dd>
            </div>
            <div>
              <dt>{language.t("cases.tools")}</dt>
              <dd>{tools}</dd>
            </div>
          </dl>
        </header>

        <div class="cases-toolbar">
          <label class="cases-search">
            <IconSearch size={16} />
            <span class="sr-only">{language.t("cases.search")}</span>
            <input
              type="search"
              value={state.query}
              onInput={(event) => setState("query", event.currentTarget.value)}
              placeholder={language.t("cases.searchPlaceholder")}
            />
          </label>
          <div class="cases-filters" aria-label={language.t("cases.filters")}>
            <button type="button" aria-pressed={state.filter === "all"} onClick={() => setState("filter", "all")}>
              {language.t("cases.all")}
            </button>
            <For each={filters}>
              {(group) => (
                <button type="button" aria-pressed={state.filter === group} onClick={() => setState("filter", group)}>
                  {group}
                </button>
              )}
            </For>
          </div>
        </div>

        <div class="cases-results">
          <div>
            <h2>{language.t("cases.results")}</h2>
            <span>{language.t("cases.showing", { count: shown().length })}</span>
          </div>
        </div>

        <Show
          when={shown().length > 0}
          fallback={<p class="cases-empty">{language.t("cases.noResults")}</p>}
        >
          <div class="cases-grid">
            <For each={shown()}>
              {(item) => (
                <A class="case-card" href={replay(item)} data-case={item.id}>
                  <span class="case-cover" data-fit={"imageFit" in item ? item.imageFit : undefined} aria-hidden="true">
                    <img src={item.images[0]} alt="" />
                    <img src={item.images[1]} alt="" />
                    <img src={item.images[2]} alt="" />
                    <b>▶</b>
                  </span>
                  <span class="case-meta">
                    <span class="case-tags">
                      <b>{item.omics}</b>
                      <For each={item.tool.split(" + ")}>{(tool) => <b>{tool}</b>}</For>
                      <Show when={"series" in item ? item.series : undefined}>{(series) => <b>{series()}</b>}</Show>
                    </span>
                    <span>{item.frames} {language.t("cases.frames")}</span>
                  </span>
                  <strong class="case-title">{item.title}</strong>
                  <span class="case-story">
                    <span>
                      <b>{language.t("cases.question")}</b>
                      {item.question}
                    </span>
                    <span>
                      <b>{language.t("cases.data")}</b>
                      {item.data}
                    </span>
                    <span>
                      <b>{language.t("cases.finding")}</b>
                      {item.result}
                    </span>
                  </span>
                  <span class="case-action">{language.t("cases.open")} →</span>
                </A>
              )}
            </For>
          </div>
        </Show>
      </section>
    </main>
  )
}
