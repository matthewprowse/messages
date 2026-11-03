// Classes shared by every item in the navigation rail (app-shell, the New menu, the usage ring). On wide screens (lg up)
// the rail is a sidebar: each item shows its icon and full name, and the name tooltips step aside. Tablets keep the
// icon-only rail, where the page itself needs the width.

/** On an icon Button: grows to the rail's width with the icon and name side by side. */
export const RAIL_ITEM = "lg:w-full lg:justify-start lg:gap-2 lg:px-2.5";
/** The item's name, shown from lg up. */
export const RAIL_LABEL = "hidden truncate lg:inline";
/** On a tooltip or hover card that only repeats the name: hidden once the name is on screen. */
export const RAIL_TIP = "lg:hidden";
