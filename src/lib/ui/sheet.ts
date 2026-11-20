/**
 * Swipe-to-close rule for bottom sheets, modelled on iOS: a long drag closes,
 * and so does a short quick flick. Upward drags never close.
 *
 * @param dragPx    how far the sheet was pulled down (px, positive = down)
 * @param velocity  release speed in px/ms (positive = down)
 * @param sheetHeight rendered sheet height in px
 */
export function shouldDismiss(dragPx: number, velocity: number, sheetHeight: number): boolean {
  if (dragPx <= 0) return false;
  const distanceThreshold = Math.min(160, Math.max(80, sheetHeight * 0.3));
  if (dragPx >= distanceThreshold) return true;
  return velocity > 0.5 && dragPx > 24;
}

/** Pulling up past the top resists, like a rubber band. */
export function resistDrag(dy: number): number {
  return dy >= 0 ? dy : -Math.sqrt(-dy) * 2;
}
