import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { Wordmark } from "@/atlas/Wordmark"
import { useLanguage } from "@/context/language"
import { submitLogin, type LoginFailure } from "./login"
import "./login-dialog.css"

/**
 * Login and registration both stay in this dialog.
 *
 * Login posts to Authelia's first-factor API on the same origin, so the address
 * bar never leaves the gallery. Registration posts to Casdoor's public signup
 * API for app-axiomics-web; the account lands in the `pending` tag and an
 * administrator approves it in the console. Casdoor signs a new user in
 * automatically, which would leave a non-admin Casdoor session that the
 * admin-only console would later see — so a successful signup immediately
 * logs that session out. The workspace session is Authelia's, not Casdoor's.
 *
 * The fallback hrefs on the callers still point at `/auth`, so a visitor with
 * JavaScript disabled (or before hydration) can still sign in through the
 * portal.
 */

const SIGNUP_APPLICATION = "app-axiomics-web"
const SIGNUP_ORGANIZATION = "axiomics"

type Mode = "login" | "signup" | "pending"
type SignupResult = { status?: string; msg?: string }

export function LoginDialog(props: {
  open: boolean
  onClose: () => void
  /** Open directly in a given view. The pending view is shown when the edge
   * redirects a signed-in but not-yet-approved account to `?pending=1`. */
  initialMode?: "login" | "pending"
  /** Injectable navigation so tests do not perform a real page load. */
  onAuthenticated?: () => void
}) {
  const language = useLanguage()
  const [mode, setMode] = createSignal<Mode>("login")
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [remember, setRemember] = createSignal(true)
  const [pending, setPending] = createSignal(false)
  const [failure, setFailure] = createSignal<LoginFailure>()

  const [signupUsername, setSignupUsername] = createSignal("")
  const [signupPassword, setSignupPassword] = createSignal("")
  const [signupConfirm, setSignupConfirm] = createSignal("")
  const [signupPending, setSignupPending] = createSignal(false)
  const [signupError, setSignupError] = createSignal<string>()
  const [signupDone, setSignupDone] = createSignal(false)

  let field: HTMLInputElement | undefined
  let signupField: HTMLInputElement | undefined
  let pendingAction: HTMLButtonElement | undefined

  createEffect(() => {
    if (!props.open) return
    setMode(props.initialMode ?? "login")
    setPassword("")
    setFailure(undefined)
    setPending(false)
    setSignupUsername("")
    setSignupPassword("")
    setSignupConfirm("")
    setSignupError(undefined)
    setSignupPending(false)
    setSignupDone(false)
    queueMicrotask(() => {
      if (props.initialMode === "pending") pendingAction?.focus()
      else field?.focus()
    })
  })

  createEffect(() => {
    if (!props.open) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose()
    }
    window.addEventListener("keydown", keydown)
    onCleanup(() => window.removeEventListener("keydown", keydown))
  })

  const message = () => {
    const reason = failure()
    if (!reason) return
    if (reason === "invalid") return language.t("cases.login.invalid")
    if (reason === "throttled") return language.t("cases.login.throttled")
    if (reason === "network") return language.t("cases.login.network")
    return language.t("cases.login.unexpected")
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (pending()) return
    setPending(true)
    setFailure(undefined)
    const result = await submitLogin({
      username: username(),
      password: password(),
      remember: remember(),
    })
    setPending(false)
    if (!result.ok) {
      setFailure(result.reason)
      return
    }
    if (props.onAuthenticated) props.onAuthenticated()
    else location.assign("/axiomics")
  }

  const switchToSignup = () => {
    setMode("signup")
    setSignupError(undefined)
    setSignupDone(false)
    queueMicrotask(() => signupField?.focus())
  }

  const switchToLogin = () => {
    setMode("login")
    setSignupError(undefined)
    setSignupDone(false)
    setFailure(undefined)
    queueMicrotask(() => field?.focus())
  }

  const submitSignup = async (event: SubmitEvent) => {
    event.preventDefault()
    if (signupPending()) return
    const name = signupUsername().trim()
    if (!name || !signupPassword()) return
    if (signupPassword() !== signupConfirm()) {
      setSignupError(language.t("cases.signup.mismatch"))
      return
    }

    setSignupPending(true)
    setSignupError(undefined)
    const locale = language.locale()
    try {
      const response = await fetch("/console/api/signup", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": locale.startsWith("zh") ? "zh-CN" : locale,
        },
        body: JSON.stringify({
          application: SIGNUP_APPLICATION,
          organization: SIGNUP_ORGANIZATION,
          username: name,
          password: signupPassword(),
          agreement: true,
          language: locale.startsWith("zh") ? "zh" : "en",
        }),
      })
      const result = (await response.json()) as SignupResult
      if (result.status !== "ok") {
        setSignupError(result.msg || language.t("cases.signup.failed"))
        return
      }
      // Drop the Casdoor session the signup API just created. The console is
      // admin-only, and the workspace authenticates through Authelia.
      await fetch("/console/api/logout", { method: "POST", credentials: "include" }).catch(
        () => undefined,
      )
      setSignupDone(true)
    } catch {
      setSignupError(language.t("cases.signup.network"))
    } finally {
      setSignupPending(false)
    }
  }

  const loginView = () => (
    <>
      <h2 class="login-dialog__title" id="login-dialog-title">
        {language.t("cases.login.title")}
      </h2>
      <p class="login-dialog__note">{language.t("cases.login.description")}</p>

      <form class="login-dialog__form" onSubmit={submit}>
        <label class="login-dialog__field">
          <span>{language.t("cases.login.username")}</span>
          <input
            ref={field}
            name="username"
            autocomplete="username"
            required
            value={username()}
            onInput={(event) => setUsername(event.currentTarget.value)}
          />
        </label>
        <label class="login-dialog__field">
          <span>{language.t("cases.login.password")}</span>
          <input
            name="password"
            type="password"
            autocomplete="current-password"
            required
            value={password()}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </label>
        <label class="login-dialog__check">
          <input
            type="checkbox"
            checked={remember()}
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />
          <span>{language.t("cases.login.remember")}</span>
        </label>

        <Show when={message()}>
          {(text) => (
            <p class="login-dialog__error" role="alert">
              {text()}
            </p>
          )}
        </Show>

        <button type="submit" class="login-dialog__submit" disabled={pending()} aria-busy={pending()}>
          {pending() ? language.t("cases.login.submitting") : language.t("cases.login.submit")}
        </button>
      </form>

      <p class="login-dialog__alt">
        <span>{language.t("cases.login.signupHint")}</span>
        <button type="button" class="login-dialog__switch" onClick={switchToSignup}>
          {language.t("cases.login.signup")}
        </button>
      </p>
    </>
  )

  const signupView = () => (
    <Show
      when={!signupDone()}
      fallback={
        <>
          <h2 class="login-dialog__title" id="login-dialog-title">
            {language.t("cases.signup.doneTitle")}
          </h2>
          <p class="login-dialog__note">{language.t("cases.signup.doneText")}</p>
          <button type="button" class="login-dialog__submit" onClick={switchToLogin}>
            {language.t("cases.signup.back")}
          </button>
        </>
      }
    >
      <h2 class="login-dialog__title" id="login-dialog-title">
        {language.t("cases.signup.title")}
      </h2>
      <p class="login-dialog__note">{language.t("cases.signup.description")}</p>

      <form class="login-dialog__form" onSubmit={submitSignup}>
        <label class="login-dialog__field">
          <span>{language.t("cases.signup.username")}</span>
          <input
            ref={signupField}
            name="signup-username"
            autocomplete="username"
            required
            value={signupUsername()}
            onInput={(event) => setSignupUsername(event.currentTarget.value)}
          />
        </label>
        <label class="login-dialog__field">
          <span>{language.t("cases.signup.password")}</span>
          <input
            name="signup-password"
            type="password"
            autocomplete="new-password"
            required
            value={signupPassword()}
            onInput={(event) => setSignupPassword(event.currentTarget.value)}
          />
        </label>
        <label class="login-dialog__field">
          <span>{language.t("cases.signup.confirm")}</span>
          <input
            name="signup-confirm"
            type="password"
            autocomplete="new-password"
            required
            value={signupConfirm()}
            onInput={(event) => setSignupConfirm(event.currentTarget.value)}
          />
        </label>

        <Show when={signupError()}>
          {(text) => (
            <p class="login-dialog__error" role="alert">
              {text()}
            </p>
          )}
        </Show>

        <button
          type="submit"
          class="login-dialog__submit"
          disabled={signupPending()}
          aria-busy={signupPending()}
        >
          {signupPending()
            ? language.t("cases.signup.submitting")
            : language.t("cases.signup.submit")}
        </button>
      </form>

      <p class="login-dialog__alt">
        <span>{language.t("cases.signup.haveAccount")}</span>
        <button type="button" class="login-dialog__switch" onClick={switchToLogin}>
          {language.t("cases.signup.login")}
        </button>
      </p>
    </Show>
  )

  const pendingView = () => (
    <>
      <span class="login-dialog__tag">{language.t("cases.pending.tag")}</span>
      <h2 class="login-dialog__title" id="login-dialog-title">
        {language.t("cases.pending.title")}
      </h2>
      <p class="login-dialog__note">{language.t("cases.pending.description")}</p>
      <p class="login-dialog__note login-dialog__note--muted">{language.t("cases.pending.hint")}</p>
      <button
        ref={pendingAction}
        type="button"
        class="login-dialog__submit"
        onClick={props.onClose}
      >
        {language.t("cases.pending.back")}
      </button>
      <p class="login-dialog__alt">
        <button type="button" class="login-dialog__switch" onClick={switchToLogin}>
          {language.t("cases.pending.other")}
        </button>
      </p>
    </>
  )

  return (
    <Show when={props.open}>
      <div
        class="login-dialog"
        role="presentation"
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onClose()
        }}
      >
        <div
          class="login-dialog__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-dialog-title"
        >
          <header class="login-dialog__head">
            <Wordmark size="sm" />
            <button
              type="button"
              class="login-dialog__close"
              aria-label={language.t("cases.login.close")}
              onClick={props.onClose}
            >
              ×
            </button>
          </header>

          <Show when={mode() === "login"} fallback={mode() === "signup" ? signupView() : pendingView()}>
            {loginView()}
          </Show>
        </div>
      </div>
    </Show>
  )
}
