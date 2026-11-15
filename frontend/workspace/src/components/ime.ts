/** Whether a key event belongs to the operating system's input method.
 *
 * `isComposing` is the standard signal, and since an IME that is committing
 * text sets it too, a composition-confirming Enter is still recognised.
 *
 * `keyCode === 229` used to stand in for it. It cannot: a browser reports 229
 * for ordinary keys once an IME is active, including Enter pressed after the
 * composition already ended. Measured in the running product, an Enter whose
 * keyCode was 229 and whose isComposing was false sent nothing — no request, no
 * toast, text left in the composer. The local `composing` flag still covers a
 * browser that lags on `isComposing`; a flag that outlives its composition is
 * cleared by `staleComposition`.
 */
export function imeOwnsKey(event: KeyboardEvent, composing: boolean) {
  return event.isComposing || composing
}

/** A composition that never ended. `compositionend` can be missed — the IME
 * commits without firing it, or the field keeps focus — and the stuck flag
 * then keeps Enter dead until the user clicks elsewhere and back (the focus
 * reset in the composer). Measured: with the flag stuck, Enter sent nothing;
 * one blur and refocus later the same Enter sent. The event is the better
 * authority, so a keydown that is not composing proves the composition is over.
 */
export function staleComposition(event: KeyboardEvent, composing: boolean) {
  return composing && !event.isComposing
}
