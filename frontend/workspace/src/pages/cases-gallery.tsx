import { A } from "@solidjs/router"
import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import {
  IconBookOpen,
  IconResearch,
  IconSearch,
} from "@/atlas/shared/Icon"
import { Wordmark } from "@/atlas/Wordmark"
import { useLanguage } from "@/context/language"
import { cases, cover, replay, select } from "./cases/catalog"
import "./cases/cases.css"

/** Router links in the authenticated app; plain anchors on the public page so
 * a click never enters the SPA router (and never calls a tenant API). */
function NavLink(props: {
  href: string
  anchor: boolean
  class?: string
  label?: string
  current?: boolean
  onClick?: (event: MouseEvent) => void
  children: JSX.Element
}) {
  if (props.anchor)
    return (
      <a
        href={props.href}
        class={props.class}
        aria-label={props.label}
        aria-current={props.current ? "page" : undefined}
        onClick={props.onClick}
      >
        {props.children}
      </a>
    )
  return (
    <A href={props.href} class={props.class} aria-label={props.label} aria-current={props.current ? "page" : undefined}>
      {props.children}
    </A>
  )
}

function CaseCard(props: { href: string; anchor: boolean; id: string; children: JSX.Element }) {
  if (props.anchor)
    return (
      <a class="case-card" href={props.href} data-case={props.id}>
        {props.children}
      </a>
    )
  return (
    <A class="case-card" href={props.href} data-case={props.id}>
      {props.children}
    </A>
  )
}

export default function CasesGallery(props: { public?: boolean } = {}) {
  const language = useLanguage()
  const [state, setState] = createStore({ query: "", filter: "all" })
  const groups = [...new Set(cases.map((item) => item.omics))]
  const filters = [...groups, ...new Set(cases.flatMap((item) => "series" in item ? [item.series] : []))]
  const tools = new Set(cases.flatMap((item) => item.tool.split(" + "))).size
  const shown = createMemo(() => select(state.query, state.filter))
  // "New research" opens the conversation first and asks for an account only
  // when the visitor submits: the static shell carries the empty workspace, so
  // the gallery links into it rather than to the login portal.
  const newHref = () => (props.public ? "#/new" : "/")

  // 退出登录后回到这一页：本站的会话已经清掉，但统一认证（CAS）的会话还在，
  // 所以再点"开始使用"会不输密码直接回来。这句话是唯一能把这件事讲清楚的地方，
  // 它不是提示，是安全边界——不讲，用户会以为退出保护了更多。
  const signedOutAtLoad = (() => {
    if (!props.public || typeof window === "undefined") return false
    try {
      return new URLSearchParams(window.location.search).get("signedout") === "1"
    } catch {
      return false
    }
  })()
  // A signal, not a constant: dismissing has to actually close the dialog.
  // Dropping the query string alone leaves the component mounted with its
  // original value and nothing visibly happens.
  const [signedOut, setSignedOut] = createSignal(signedOutAtLoad)
  const dismissSignedOut = () => {
    setSignedOut(false)
    const url = new URL(window.location.href)
    url.searchParams.delete("signedout")
    history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
  }

  return (
    <main class="cases-shell">
      <aside class="cases-nav">
        <NavLink class="cases-brand" href={props.public ? "#/" : "/"} anchor={props.public ?? false} label="Axiomics">
          <Wordmark size="sm" />
        </NavLink>
        <nav aria-label={language.t("cases.navigation")}>
          <NavLink href={newHref()} anchor={props.public ?? false}>
            <IconResearch size={16} />
            {language.t("cases.new")}
          </NavLink>
          <NavLink href={props.public ? "#/" : "/cases"} anchor={props.public ?? false} current>
            <IconBookOpen size={16} />
            {language.t("cases.title")}
          </NavLink>
        </nav>
      </aside>

      <section class="cases-page" aria-labelledby="cases-title">
        <Show when={signedOut()}>
          <div class="cases-dialog" onClick={dismissSignedOut}>
            <div
              class="cases-dialog__panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cases-signedout-title"
              tabIndex={-1}
              ref={(el) => queueMicrotask(() => el.focus())}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") dismissSignedOut()
              }}
            >
              <h2 class="cases-dialog__title" id="cases-signedout-title">
                {language.t("cases.signedOut.title")}
              </h2>
              <p class="cases-dialog__note">{language.t("cases.signedOut.note")}</p>
              <button type="button" class="cases-dialog__primary" onClick={dismissSignedOut}>
                {language.t("cases.signedOut.close")}
              </button>
            </div>
          </div>
        </Show>
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
            <span>
              {language.t(shown().length === 1 ? "cases.showingOne" : "cases.showing", {
                count: shown().length,
              })}
            </span>
          </div>
        </div>

        <Show
          when={shown().length > 0}
          fallback={<p class="cases-empty">{language.t("cases.noResults")}</p>}
        >
          <div class="cases-grid">
            <For each={shown()}>
              {(item) => (
                <CaseCard
                  href={props.public ? `#/replay/${item.id}` : replay(item)}
                  anchor={props.public ?? false}
                  id={item.id}
                >
                  <span class="case-cover" data-fit={"imageFit" in item ? item.imageFit : undefined} aria-hidden="true">
                    <img src={cover(item.images[0])} alt="" loading="lazy" decoding="async" />
                    <img src={cover(item.images[1])} alt="" loading="lazy" decoding="async" />
                    <img src={cover(item.images[2])} alt="" loading="lazy" decoding="async" />
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
                </CaseCard>
              )}
            </For>
          </div>
        </Show>
      </section>
    </main>
  )
}
