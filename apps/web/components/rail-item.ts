// Classes shared by every item in the navigation rail (app-shell, the New menu, the usage ring). The rail is icons only at
// every width: each item is a 40px square, and its name shows in a tooltip (or, for the usage ring, its hover card).

/** On an icon Button: the rail's 40px square. */
export const RAIL_ITEM = "size-10";
/** The item's name inside the button: kept out of sight, since the button's aria-label already names it. */
export const RAIL_LABEL = "hidden";
/** On a tooltip or hover card that only repeats the name. Nothing to hide now that names are never on screen. */
export const RAIL_TIP = "";
