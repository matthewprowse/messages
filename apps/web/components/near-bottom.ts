// Whether a scroll viewport sits close enough to its bottom to follow new messages. Shared by the inbox thread and the
// shared chat so both decide "near the bottom" the same way.

/** How far from the bottom (px) still counts as being at it. */
export const NEAR_BOTTOM_PX = 120;

/** True when the viewport is scrolled to within NEAR_BOTTOM_PX of its end. */
export function isNearBottom(el: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}
