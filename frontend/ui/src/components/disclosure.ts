import { createEffect, createSignal, on } from "solid-js"

/** A presentation owner can set disclosure state at a revision boundary.
 * Readers may still toggle it until the next revision is presented. */
export type Disclosure = {
  open: boolean
  revision: string | number
}

export function createDisclosure(
  props: { disclosure?: Disclosure },
  initial: () => boolean,
  persist?: (open: boolean) => void,
) {
  const [open, setOpen] = createSignal(initial())
  createEffect(
    on(
      () => props.disclosure?.revision,
      () => {
        const disclosure = props.disclosure
        if (disclosure) setOpen(disclosure.open)
      },
    ),
  )
  return [
    open,
    (value: boolean) => {
      setOpen(value)
      if (!props.disclosure) persist?.(value)
    },
  ] as const
}
