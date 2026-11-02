// The class strings that fade a conversation row's content under its hover and swipe actions. Plain constants, so
// ThreadRow and SubscriptionRow share one set of numbers.

// On hover a row's content fades out over the 32px before its action buttons and is gone beneath them.
// Each button is 32px with 4px between, 12px from the right edge. Keyed by the number of buttons.
export const FADE: Record<1 | 2, string> = {
  1: "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-76px),transparent_calc(100%-44px))] [&_[data-hover-hide]]:group-hover/row:invisible group-focus-within/row:[mask-image:linear-gradient(to_right,black_calc(100%-76px),transparent_calc(100%-44px))] pointer-coarse:[mask-image:linear-gradient(to_right,black_calc(100%-76px),transparent_calc(100%-44px))] [&_[data-hover-hide]]:group-focus-within/row:invisible [&_[data-hover-hide]]:pointer-coarse:invisible",
  2: "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-112px),transparent_calc(100%-80px))] [&_[data-hover-hide]]:group-hover/row:invisible group-focus-within/row:[mask-image:linear-gradient(to_right,black_calc(100%-112px),transparent_calc(100%-80px))] pointer-coarse:[mask-image:linear-gradient(to_right,black_calc(100%-112px),transparent_calc(100%-80px))] [&_[data-hover-hide]]:group-focus-within/row:invisible [&_[data-hover-hide]]:pointer-coarse:invisible",
};

// Conversation rows (here and on Summary) fade for their actions only with a mouse, or on a phone once
// swiped: a phone shows the photo, the time and the unread count, and a swipe to the left brings the
// actions and the checkbox out. Focus fades a row only with a mouse, as a tap focuses the row it opens.
export const ROW_FADE =
  "group-hover/row:[mask-image:linear-gradient(to_right,black_calc(100%-148px),transparent_calc(100%-116px))] [&_[data-hover-hide]]:group-hover/row:invisible pointer-fine:group-focus-within/row:[mask-image:linear-gradient(to_right,black_calc(100%-148px),transparent_calc(100%-116px))] [&_[data-hover-hide]]:pointer-fine:group-focus-within/row:invisible";
export const SWIPED_FADE = "[mask-image:linear-gradient(to_right,black_calc(100%-148px),transparent_calc(100%-116px))] [&_[data-hover-hide]]:invisible";
/** How far a finger moves sideways, and more sideways than down, before it counts as a swipe. */
export const SWIPE_PX = 32;
