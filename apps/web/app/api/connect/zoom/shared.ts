/** The Zoom sign-in in progress, sealed in a cookie between starting it and Zoom's callback. */
export interface ZoomSignIn {
  userId: string;
  state: string;
  verifier: string;
  expires: number;
}

export const ZOOM_COOKIE = "konva_zoom_connect";

/** Where a Zoom sign-in returns to. */
export const ZOOM_RETURN = "/settings/accounts/zoom";
