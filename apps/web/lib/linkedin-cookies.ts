// LinkedIn signs in with your browser's session cookies: li_at and JSESSIONID copied on their own, or a whole
// "Copy as cURL" from the browser's developer tools, the way the mautrix LinkedIn bridge accepts them. These
// turn either into what the sync worker's LinkedIn helper takes. Pure, and never logs what it reads.

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
