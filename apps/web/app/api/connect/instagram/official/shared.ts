/** The Instagram sign-in in progress, sealed in a cookie between starting it and Instagram's callback. */
export interface InstagramSignIn {
  userId: string;
  state: string;
  expires: number;
}

export const INSTAGRAM_COOKIE = "konva_instagram_connect";

/** Where an Instagram sign-in returns to. */
export const INSTAGRAM_RETURN = "/settings/accounts/instagram";

/** The label of a Business or Creator account in Connected Accounts; instagram-window.ts tells the kinds apart by it. */
export const INSTAGRAM_OFFICIAL_LABEL = "Instagram Professional";
