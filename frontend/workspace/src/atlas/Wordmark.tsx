import { type JSX, Show } from "solid-js"
import { FONT_SANS } from "@/styles/tokens"

interface WordmarkProps {
  size?: "sm" | "md" | "lg"
  /** Label only (no logo) for tight spaces. */
  textOnly?: boolean
  onClick?: () => void
}

let markSeq = 0

export function Wordmark(props: WordmarkProps): JSX.Element {
  const size = () => props.size ?? "md"
  const seq = ++markSeq
  const bgId = `ax-bg-${seq}`
  const strandId = `ax-strand-${seq}`
  const px = () =>
    size() === "lg" ? { logo: 30, text: 28 } : size() === "sm" ? { logo: 20, text: 14.5 } : { logo: 26, text: 22 }
  const weight = () => (size() === "sm" ? "var(--font-weight-emphasis)" : "var(--font-weight-regular)")
  const rootStyle = (): JSX.CSSProperties => ({
    all: "unset",
    cursor: props.onClick ? "pointer" : "default",
    display: "inline-flex",
    "align-items": "center",
    gap: size() === "sm" ? "7px" : "10px",
  })
  const content = () => (
    <>
      <Show when={!props.textOnly}>
        <svg
          viewBox="0 0 512 512"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          style={{
            width: `${px().logo}px`,
            height: `${px().logo}px`,
            "flex-shrink": 0,
          }}
        >
          <defs>
            <linearGradient id={bgId} x1="64" y1="32" x2="448" y2="480" gradientUnits="userSpaceOnUse">
              <stop stop-color="#102f35" />
              <stop offset="1" stop-color="#07171b" />
            </linearGradient>
            <linearGradient id={strandId} x1="130" y1="390" x2="382" y2="102" gradientUnits="userSpaceOnUse">
              <stop stop-color="#39d7c4" />
              <stop offset="1" stop-color="#8bb8ff" />
            </linearGradient>
          </defs>
          <rect x="16" y="16" width="480" height="480" rx="112" fill={`url(#${bgId})`} />
          <path
            d="M132 390C166 304 213 181 256 104c46 78 93 201 124 286M176 304c52-32 108-32 160 0"
            fill="none"
            stroke={`url(#${strandId})`}
            stroke-width="34"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <g fill="#dffdfa" stroke="#07171b" stroke-width="8">
            <circle cx="256" cy="104" r="25" />
            <circle cx="132" cy="390" r="25" />
            <circle cx="380" cy="390" r="25" />
            <circle cx="176" cy="304" r="21" />
            <circle cx="336" cy="304" r="21" />
          </g>
        </svg>
      </Show>
      <span
        aria-hidden="true"
        style={{
          "font-family": FONT_SANS,
          "font-size": `${px().text}px`,
          "font-weight": weight(),
          "letter-spacing": "-0.02em",
          color: "var(--color-text)",
          "white-space": "nowrap",
        }}
      >
        Axiomics
      </span>
    </>
  )
  return (
    <Show
      when={props.onClick}
      fallback={
        <span class="atlas-wordmark" role="img" aria-label="Axiomics" style={rootStyle()}>
          {content()}
        </span>
      }
    >
      <button type="button" class="atlas-wordmark" aria-label="Axiomics" onClick={props.onClick} style={rootStyle()}>
        {content()}
      </button>
    </Show>
  )
}
