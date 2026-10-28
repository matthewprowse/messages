// LinkedIn signs in with an email and password, typed in Konva (see the sign-in route). This file is what is
// left of the older way and the one value a sign-in can carry beyond them, all pure and never logging what it
// reads: the session cookies copied from a browser (li_at and JSESSIONID on their own, or a whole "Copy as
// cURL" from the developer tools, the way the mautrix LinkedIn bridge accepts them), for the small
// "Sign In With Cookies Instead" fallback, and the optional proxy an account's requests go through.

export interface LinkedInSession {
  /** A Cookie header with at least li_at and JSESSIONID. */
  cookies: string;
  /** X-LI-Track and X-LI-Page-Instance, when the copied request had them. */
  xLiTrack?: string;
  pageInstance?: string;
}

const JSESSIONID = /^ajax:[0-9]+$/;

function clean(value: string): string {
  return value.trim().replace(/^"+|"+$/g, "").trim();
}

/** The session from li_at and JSESSIONID pasted on their own, or null when they do not look right. */
export function fromValues(liAt: string, jsessionid: string): LinkedInSession | null {
  const li = clean(liAt);
  const js = clean(jsessionid);
  if (li.length < 20 || /[\s;]/.test(li) || !JSESSIONID.test(js)) return null;
  return { cookies: `li_at=${li}; JSESSIONID="${js}"` };
}

/** Each quoted or bare argument of a shell command, as bash would split it. Enough for "Copy as cURL (bash)". */
function shellWords(command: string): string[] {
  const words: string[] = [];
  const text = command.replace(/\\\r?\n/g, " ");
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    let word = "";
    while (i < text.length && !/\s/.test(text[i])) {
      const c = text[i];
      if (c === "'" || (c === "$" && text[i + 1] === "'")) {
        if (c === "$") i++;
        const end = text.indexOf("'", i + 1);
        word += text.slice(i + 1, end === -1 ? undefined : end);
        i = end === -1 ? text.length : end + 1;
      } else if (c === '"') {
        let j = i + 1;
        while (j < text.length && text[j] !== '"') {
          if (text[j] === "\\" && j + 1 < text.length) j++;
          word += text[j];
          j++;
        }
        i = j + 1;
      } else {
        word += c;
        i++;
      }
    }
    words.push(word);
  }
  return words;
}

/** The session from a "Copy as cURL" of a request to linkedin.com, or null when it has no usable cookies. */
export function fromCurl(command: string): LinkedInSession | null {
  const words = shellWords(command);
  if (!words.some((w) => /linkedin\.com/i.test(w))) return null;
  let cookies = "";
  let xLiTrack: string | undefined;
  let pageInstance: string | undefined;
  for (let i = 0; i < words.length - 1; i++) {
    const flag = words[i];
    const value = words[i + 1];
    if (flag === "-b" || flag === "--cookie") cookies = value;
    if (flag === "-H" || flag === "--header") {
      const colon = value.indexOf(":");
      if (colon < 0) continue;
      const name = value.slice(0, colon).trim().toLowerCase();
      const v = value.slice(colon + 1).trim();
      if (name === "cookie") cookies = v;
      else if (name === "x-li-track") xLiTrack = v;
      else if (name === "x-li-page-instance") pageInstance = v;
    }
  }
  return fromCookieHeader(cookies, xLiTrack, pageInstance);
}

/** A Cookie header pasted on its own, or from a cURL command. */
export function fromCookieHeader(header: string, xLiTrack?: string, pageInstance?: string): LinkedInSession | null {
  const cookies = header.trim();
  const li = cookies.match(/(?:^|;\s*)li_at=([^;]+)/)?.[1];
  const js = cookies.match(/(?:^|;\s*)JSESSIONID=([^;]+)/)?.[1];
  if (!li || !js || !JSESSIONID.test(clean(js))) return null;
  return { cookies, ...(xLiTrack ? { xLiTrack } : {}), ...(pageInstance ? { pageInstance } : {}) };
}

/** Whatever was pasted in the cURL box: a cURL command or a bare Cookie header. */
export function fromPaste(text: string): LinkedInSession | null {
  const trimmed = text.trim();
  return /^curl\b/i.test(trimmed) ? fromCurl(trimmed) : fromCookieHeader(trimmed.replace(/^cookie:\s*/i, ""));
}

const PRIVATE_V4 = /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

/**
 * A proxy for one account's LinkedIn requests, as a clean URL, or null when it is not one the worker may use:
 * an http, https or socks5 address with a host, and not this machine or a private network, because the proxy is
 * connected to from the worker's side and what someone types here must not reach inside it. (A name that
 * resolves to a private address, such as 127.0.0.1.nip.io, is not caught here: the worker resolves the host and
 * refuses non-public addresses each time it connects, see vettedProxy in the worker.) The literal checks below
 * are only a first filter.
 */
export function cleanProxy(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 300) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!["http:", "https:", "socks5:", "socks5h:"].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") && !host.includes(":")) return null;
  if (PRIVATE_V4.test(host)) return null;
  if (host.includes(":") && (host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:") || host.startsWith("64:ff9b:") || host.startsWith("2002:"))) return null;
  return `${url.protocol}//${url.username ? `${url.username}${url.password ? `:${url.password}` : ""}@` : ""}${url.host}`;
}
