/** The Google sign-in in progress, sealed in a cookie between starting it and Google's callback. */
export interface GoogleSignIn {
  userId: string;
  state: string;
  verifier: string;
  back: string;
  expires: number;
}

export const GOOGLE_COOKIE = "konva_google_connect";

/** Where a Google sign-in may return to: the app, where the setup dialog picks it up, or Settings. The first is the default. */
export const GOOGLE_RETURNS = ["/summary", "/settings/accounts/google"] as const;
