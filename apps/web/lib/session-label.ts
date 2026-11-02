// Turns a sign-in's browser text (its user agent) into a short label for the list of active sessions, such as "Safari on
// iPhone". Pure and forgiving: an unknown or missing agent is "Unknown Device". No address is ever shown, only this text.

const BROWSERS: [RegExp, string][] = [[/edg(e|a|ios)?\//i, "Edge"], [/opr\/|opera/i, "Opera"], [/firefox|fxios/i, "Firefox"], [/chrome|crios/i, "Chrome"], [/safari/i, "Safari"]];
const SYSTEMS: [RegExp, string][] = [[/iphone/i, "iPhone"], [/ipad/i, "iPad"], [/android/i, "Android"], [/windows/i, "Windows"], [/mac os x|macintosh/i, "Mac"], [/cros/i, "Chromebook"], [/linux/i, "Linux"]];

/** "Safari on iPhone", "Chrome", "Mac" or "Unknown Device". */
export function sessionLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown Device";
}
