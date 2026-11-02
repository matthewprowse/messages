// Pure helpers that turn an email body into something readable in a chat bubble.
// No React and no DOM here so they can be unit tested with node:test.

export interface EmailParts {
  /** What the bubble shows. */
  body: string;
  /** Quoted history, signature and footers: left out of the bubble (View Original has them). */
  quoted?: string;
  /** Newsletter or marketing mail, which reads best in its original layout (see isBulkMail). */
  bulk?: boolean;
  /** A forwarded email, shown in its own card under the forwarder's note (body). */
  forward?: ForwardedEmail;
}

export type TextPart = { text: string } | { href: string; label: string };

// Invisible characters newsletters pad their preheaders with, which otherwise render as odd blank lines.
// The joiner U+200D stays after an emoji, where it glues several emoji into one.
const INVISIBLE = /[\u00ad\u034f\u115f\u1160\u17b4\u17b5\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufeff\uffa0\ufffc]|(?<!\p{Extended_Pictographic}\ufe0f?)\u200d/gu;
// Unusual spaces that should read as a plain one. The braille blank U+2800 is a favourite preheader filler.
const SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]/g;

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", ensp: " ", emsp: " ", thinsp: " ",
  zwnj: "", zwj: "", shy: "", lrm: "", rlm: "", copy: "©", reg: "®", trade: "™", hellip: "…", bull: "•",
  middot: "·", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", sbquo: "‚", bdquo: "„", prime: "′",
  ndash: "\u2013", mdash: "\u2014", minus: "−", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", deg: "°",
  times: "×", divide: "÷", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", frac12: "½",
  frac14: "¼", frac34: "¾", aacute: "á", agrave: "à", acirc: "â", auml: "ä", aring: "å", atilde: "ã",
  ccedil: "ç", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", iacute: "í", igrave: "ì", icirc: "î",
  iuml: "ï", ntilde: "ñ", oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", otilde: "õ", oslash: "ø",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü", yacute: "ý", szlig: "ß", Aacute: "Á", Agrave: "À",
  Auml: "Ä", Aring: "Å", Ccedil: "Ç", Eacute: "É", Egrave: "È", Ntilde: "Ñ", Oacute: "Ó", Ouml: "Ö",
  Oslash: "Ø", Uacute: "Ú", Uuml: "Ü", hearts: "♥", star: "☆", starf: "★", check: "✓", rarr: "→",
  larr: "←", uarr: "↑", darr: "↓", harr: "↔", rArr: "⇒", iexcl: "¡", iquest: "¿", ordf: "ª", ordm: "º",
  micro: "µ", plusmn: "±", sup2: "²", sup3: "³", alpha: "α", beta: "β", pi: "π", mu: "μ", infin: "∞",
};

// HTML treats numeric references 128-159 as windows-1252 characters, not C1 controls ("&#146;" is a right quote).
const CP1252 = "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178";

/** Decodes HTML character references. Named ones need their semicolon, so "?a=1&copy=2" in a link survives. */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7});?|#[xX]([0-9a-fA-F]{1,6});?|([a-zA-Z][a-zA-Z0-9]{1,9});)/g, (whole, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED[name] ?? whole;
    const n = dec ? Number(dec) : parseInt(hex ?? "", 16);
    if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "";
    if (n >= 0x80 && n <= 0x9f) { const c = CP1252[n - 0x80] ?? ""; return c < "\u00a0" && c >= "\u0080" ? "" : c; } // the five unassigned slots are dropped
    return String.fromCodePoint(n);
  });
}

// A small HTML tree, enough to turn email layouts into text. Browsers are far more forgiving and exact;
// this only needs to get the reading order, line breaks and hidden parts right.
interface El {
  tag: string;
  attrs: string;
  children: (El | string)[];
  parent?: El;
  depth: number;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "meta", "param", "source", "track", "wbr"]);
// Their content is never shown as text. Style and script content is not even parsed as HTML.
const RAW = new Set(["style", "script", "title", "textarea", "xmp"]);
const SKIP = new Set(["head", "style", "script", "title", "noscript", "template", "svg", "math", "object", "iframe", "select", "textarea", "map", "xmp"]);
const PARAGRAPH = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "dl", "pre", "figure"]);
const LINE = new Set(["div", "table", "section", "article", "header", "footer", "nav", "aside", "main", "center", "address", "dd", "dt", "caption", "form", "fieldset", "details", "summary", "figcaption", "legend", "option"]);
/** Nesting deeper than this is flattened: real emails are a few dozen levels deep, and every walk below recurses. */
const MAX_DEPTH = 100;
/** Emphasis is not worked out for HTML longer than this: a hostile email must not hold up the worker. */
const MAX_EMPHASIS_HTML = 500_000;

interface Token {
  /** The tag's name (lower case not applied), or undefined for text, comments, doctype and CDATA. */
  name?: string;
  attrs: string;
  end: number;
  /** A closing tag. */
  closing: boolean;
  /** Text and "<" only. */
  text: boolean;
}

/**
 * Splits HTML into tokens in one pass, never looking back, so a tag that never closes costs nothing extra
 * (a lone "<" is then text). Quoted attribute values may hold ">". Same tokens as the pattern it replaced:
 * comments (an unterminated one runs to the end), "<!...>" and "<?...>" declarations, CDATA, tags, text.
 */
function makeTokenizer(html: string) {
  // Once a search finds nothing from some position it finds nothing from any later one.
  const none = { gt: false, dq: false, sq: false, comment: false, cdata: false, decl: false };
  const find = (what: string, from: number, key: keyof typeof none): number => {
    if (none[key]) return -1;
    const at = html.indexOf(what, from);
    if (at < 0) none[key] = true;
    return at;
  };
  let wasted = 0;
  const lt = (pos: number): Token => ({ attrs: "", end: pos + 1, closing: false, text: true });
  return (pos: number): Token => {
    if (html[pos] !== "<") {
      const next = html.indexOf("<", pos);
      return { attrs: "", end: next < 0 ? html.length : next, closing: false, text: true };
    }
    const c1 = html[pos + 1];
    if (c1 === "!" && html.startsWith("<!--", pos)) {
      const at = find("-->", pos + 4, "comment");
      return { attrs: "", end: at < 0 ? html.length : at + 3, closing: false, text: false };
    }
    if (c1 === "!" && html.startsWith("<![CDATA[", pos)) {
      const at = find("]]>", pos + 9, "cdata");
      if (at >= 0) return { attrs: "", end: at + 3, closing: false, text: false };
    }
    if (c1 === "!" || c1 === "?") {
      const at = find(">", pos + 2, "decl");
      return at < 0 ? lt(pos) : { attrs: "", end: at + 1, closing: false, text: false };
    }
    const closing = c1 === "/";
    let i = pos + (closing ? 2 : 1);
    const nameStart = i;
    if (!/[a-zA-Z]/.test(html[i] ?? "")) return lt(pos);
    while (i < html.length && /[\w:-]/.test(html[i])) i++;
    const name = html.slice(nameStart, i);
    const attrsStart = i;
    // Scans that end in nothing are paid for from a budget, so odd quoting cannot make many of them add up.
    if (wasted > 4 * html.length + 1000 || find(">", attrsStart, "gt") < 0) return lt(pos);
    const fail = () => { wasted += i - pos; return lt(pos); };
    for (;;) {
      if (i >= html.length) return fail();
      const ch = html[i];
      if (ch === ">") return { name, attrs: html.slice(attrsStart, i), end: i + 1, closing, text: false };
      if (ch === '"' || ch === "'") {
        const at = find(ch, i + 1, ch === '"' ? "dq" : "sq");
        if (at < 0) return fail();
        i = at + 1;
        continue;
      }
      // Plain characters up to the next quote or ">".
      let j = i + 1;
      while (j < html.length && html[j] !== ">" && html[j] !== '"' && html[j] !== "'") j++;
      i = j;
    }
  };
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : undefined;
}

function parseHtml(html: string): { root: El; styles: string[]; text: string } {
  const root: El = { tag: "#root", attrs: "", children: [], depth: 0 };
  const styles: string[] = [];
  const texts: string[] = [];
  const lower = html.toLowerCase();
  let cur = root;
  // Closes the nearest open element named in names, unless one of the boundaries comes first.
  const closeOpen = (names: string[], boundaries: string[]) => {
    for (let e: El | undefined = cur; e && e !== root; e = e.parent) {
      if (names.includes(e.tag)) { cur = e.parent ?? root; return; }
      if (boundaries.includes(e.tag)) return;
    }
  };
  const next = makeTokenizer(html);
  let pos = 0;
  while (pos < html.length) {
    const start = pos;
    const t = next(pos);
    pos = t.end;
    if (!t.name) {
      if (t.text) { const text = html.slice(start, pos); cur.children.push(text); texts.push(text); }
      continue; // comments (Outlook's conditional ones included), doctype and CDATA
    }
    const tag = t.name.toLowerCase();
    if (t.closing) { closeOpen([tag], []); continue; }
    // Tags HTML closes for you when the next one starts.
    if (tag === "body") closeOpen(["head"], []);
    else if (tag === "p") closeOpen(["p"], ["td", "th", "li", "div", "table", "blockquote", "body"]);
    else if (tag === "li") closeOpen(["li"], ["ul", "ol", "table"]);
    else if (tag === "dt" || tag === "dd") closeOpen(["dt", "dd"], ["dl"]);
    else if (tag === "td" || tag === "th") closeOpen(["td", "th"], ["tr", "table"]);
    else if (tag === "tr") closeOpen(["tr"], ["table"]);
    else if (tag === "tbody" || tag === "thead" || tag === "tfoot") closeOpen(["tbody", "thead", "tfoot"], ["table"]);
    else if (tag === "option") closeOpen(["option"], ["select"]);
    const el: El = { tag, attrs: t.attrs, children: [], parent: cur, depth: cur.depth + 1 };
    cur.children.push(el);
    if (RAW.has(tag)) {
      const end = lower.indexOf(`</${tag}`, pos);
      const content = html.slice(pos, end < 0 ? html.length : end);
      if (tag === "style") styles.push(content);
      const close = end < 0 ? -1 : html.indexOf(">", end);
      pos = close < 0 ? html.length : close + 1; // an unclosed one runs to the end, so this search is made once
      continue;
    }
    if (VOID.has(tag) || /\/\s*$/.test(t.attrs)) continue;
    if (el.depth < MAX_DEPTH) cur = el; // deeper than this, an element holds nothing and stays flat
  }
  return { root, styles, text: decodeEntities(texts.join(" ")).replace(/\s+/g, " ").toLowerCase() };
}

const HIDDEN_STYLE = /(?:^|;|\s)(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:!important\s*)?(?:;|$))/i;
const NO_HEIGHT = /(?:^|;|\s)(?:max-)?height\s*:\s*0(?:px)?\s*(?:!important\s*)?(?:;|$)/i;

/** Classes the email's own style sheet hides outside any media query, such as a ".preheader" rule. */
function hiddenClasses(styles: string[]): Set<string> {
  const out = new Set<string>();
  for (const sheet of styles) {
    let css = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
    // Rules inside @media blocks only apply on some screens, so they are dropped before looking.
    for (let at = css.search(/@media\b/i); at >= 0; at = css.search(/@media\b/i)) {
      const open = css.indexOf("{", at);
      if (open < 0) { css = css.slice(0, at); break; }
      let depth = 0;
      let end = open;
      for (; end < css.length; end++) {
        if (css[end] === "{") depth++;
        else if (css[end] === "}" && --depth === 0) break;
      }
      css = css.slice(0, at) + css.slice(end + 1);
    }
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!HIDDEN_STYLE.test(rule[2])) continue;
      for (const selector of rule[1].split(",")) {
        const cls = /^\s*[a-z]*\.([\w-]+)\s*$/i.exec(selector);
        if (cls) out.add(cls[1]);
      }
    }
  }
  return out;
}

function isHidden(el: El, classes: Set<string>): boolean {
  if (SKIP.has(el.tag) || /(?:^|\s)hidden(?:[\s=/]|$)/i.test(el.attrs)) return true;
  const style = attr(el.attrs, "style") ?? "";
  if (HIDDEN_STYLE.test(style) || (NO_HEIGHT.test(style) && /overflow\s*:\s*hidden/i.test(style))) return true;
  if (classes.size === 0) return false;
  return (attr(el.attrs, "class") ?? "").split(/\s+/).some((c) => classes.has(c));
}

// Alt text that only names the picture ("Logo", "Facebook icon") is noise when read out as text.
const ALT_NOISE = /\b(?:logo|icon|spacer|pixel|banner|image|img|photo|picture|facebook|instagram|twitter|youtube|linkedin|tiktok|pinterest|whatsapp|snapchat|threads|social|arrow|divider|hero|button|header|footer)\b/i;

function usefulAlt(alt: string, docText: string): boolean {
  if (alt.length < 4 || !/\p{L}/u.test(alt) || !/\s/.test(alt)) return false;
  if (/\.(?:png|jpe?g|gif|webp|svg)$/i.test(alt)) return false;
  if (alt.split(/\s+/).length <= 4 && ALT_NOISE.test(alt)) return false;
  // Alt text that repeats words already on the page adds nothing.
  return !docText.includes(alt.toLowerCase());
}

interface RenderState {
  classes: Set<string>;
  docText: string;
  hrefs: Set<string>;
}

function renderChildren(el: El, st: RenderState, zeroFont: boolean, pre: boolean): string {
  return el.children.map((c) => renderNode(c, st, zeroFont, pre)).join("");
}

function renderNode(node: El | string, st: RenderState, zeroFont: boolean, pre: boolean): string {
  if (typeof node === "string") {
    if (zeroFont) return "";
    const text = decodeEntities(node);
    return pre ? text : text.replace(/[ \t\n\r\f]+/g, " ");
  }
  const el = node;
  if (isHidden(el, st.classes)) return "";
  const size = /font-size\s*:\s*([\d.]+)/i.exec(attr(el.attrs, "style") ?? "");
  // font-size:0 hides text, but layouts also use it to close gaps between columns that set their own size.
  const zero = size ? Number(size[1]) === 0 : zeroFont;
  const isPre = pre || el.tag === "pre";
  const inner = () => renderChildren(el, st, zero, isPre);
  switch (el.tag) {
    case "br":
      return "\n";
    case "hr":
      return PARA_BREAK;
    case "img": {
      if (zero) return "";
      const tiny = (v?: string) => v !== undefined && /^\s*\d/.test(v) && parseInt(v, 10) <= 3;
      if (tiny(attr(el.attrs, "width")) || tiny(attr(el.attrs, "height"))) return "";
      const alt = (attr(el.attrs, "alt") ?? "").replace(/\s+/g, " ").trim();
      return usefulAlt(alt, st.docText) ? ` ${alt} ` : "";
    }
    case "a": {
      const raw = inner();
      const label = unpad(raw);
      const href = (attr(el.attrs, "href") ?? "").trim();
      if (!label || !/^https?:\/\/[^\s]+$/i.test(href) || st.hrefs.has(href)) return raw;
      // A label that already shows an address needs no second copy of it.
      if (/^(?:https?:\/\/|www\.)\S+$/i.test(label)) return raw;
      st.hrefs.add(href);
      return `${/^\s/.test(raw) ? " " : ""}${label} (${href})${/\s$/.test(raw) ? " " : ""}`;
    }
    case "li": {
      const list = el.parent?.tag === "ol" ? el.parent : undefined;
      const n = list ? list.children.filter((c) => typeof c !== "string" && c.tag === "li").indexOf(el) + 1 : 0;
      return `${LINE_BREAK}${n ? `${n}. ` : "• "}${unpad(resolveBreaks(inner()))}${LINE_BREAK}`;
    }
    case "tr": {
      // A row of short cells (a label and a price, say) reads as one line. Cells holding blocks stack.
      const cells = el.children.map((c) => unpad(resolveBreaks(renderNode(c, st, zero, isPre)))).filter((c) => /[\p{L}\p{N}]/u.test(c));
      if (cells.length > 1 && cells.every((c) => !c.includes("\n") && c.length <= 60)) return `${LINE_BREAK}${cells.join(" · ")}${LINE_BREAK}`;
      return `${LINE_BREAK}${cells.join("\n")}${LINE_BREAK}`;
    }
    case "p": {
      // Layouts wrap every short label in its own paragraph. Only real paragraphs get a blank line around them.
      const s = inner();
      const t = unpad(s);
      return t.length <= 60 && !/[\n\u0002\u0003]/.test(t) ? `${LINE_BREAK}${s}${LINE_BREAK}` : `${PARA_BREAK}${s}${PARA_BREAK}`;
    }
    default: {
      if (PARAGRAPH.has(el.tag)) return `${PARA_BREAK}${inner()}${PARA_BREAK}`;
      if (LINE.has(el.tag)) return `${LINE_BREAK}${inner()}${LINE_BREAK}`;
      return inner();
    }
  }
}

// Block edges are marked while rendering and settled afterwards, so that two blocks meeting give one line
// break, not two. A paragraph edge anywhere in a run of them makes it a blank line.
const LINE_BREAK = String.fromCharCode(2);
const PARA_BREAK = String.fromCharCode(3);
const BREAKS = /[ \t]*(?:[\u0002\u0003][ \t]*)+/g;

function resolveBreaks(s: string): string {
  return s.replace(BREAKS, (run) => (run.includes(PARA_BREAK) ? "\n\n" : "\n"));
}

function unpad(s: string): string {
  return s.replace(/^[\s\u0002\u0003]+|[\s\u0002\u0003]+$/g, "");
}

/** Plain text from email HTML: blocks become lines, links keep their address, hidden and decorative parts go. */
export function htmlToText(html: string): string {
  const { root, styles, text } = parseHtml(html);
  const out = resolveBreaks(renderChildren(root, { classes: hiddenClasses(styles), docText: text, hrefs: new Set() }, false, false));
  const lines: string[] = [];
  for (const raw of out.replace(INVISIBLE, "").replace(SPACES, " ").split("\n")) {
    const line = raw.replace(/[ \t]+/g, " ").trim();
    if (!line) { lines.push(""); continue; }
    // Lines of only dots, bars or symbols are spacer cells and dividers.
    if (!/[\p{L}\p{N}]/u.test(line)) continue;
    // The same line twice in a row is usually a desktop and a mobile copy of one block.
    let prev = lines.length - 1;
    while (prev >= 0 && lines[prev] === "") prev--;
    if (prev >= 0 && lines[prev] === line) continue;
    lines.push(line);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type Mark = "bold" | "italic" | "underline" | "strike" | "code";

/** A run of an email's text that its HTML styled, in the order the HTML has them. */
export interface Emphasis {
  text: string;
  mark: Mark;
}

const MARK_TAGS: Record<string, Mark> = {
  b: "bold", strong: "bold", h1: "bold", h2: "bold", h3: "bold", h4: "bold", h5: "bold", h6: "bold",
  i: "italic", em: "italic", u: "underline", ins: "underline", s: "strike", strike: "strike", del: "strike",
  code: "code", tt: "code", kbd: "code", samp: "code",
};

function styleMarks(style: string): Mark[] {
  const out: Mark[] = [];
  if (/font-weight\s*:\s*(?:bold(?:er)?|[6-9]00)\b/i.test(style)) out.push("bold");
  if (/font-style\s*:\s*italic\b/i.test(style)) out.push("italic");
  if (/text-decoration(?:-line)?\s*:[^;]*\bunderline\b/i.test(style)) out.push("underline");
  if (/text-decoration(?:-line)?\s*:[^;]*\bline-through\b/i.test(style)) out.push("strike");
  return out;
}

/** The visible words inside an element. Links are only their label here. */
function plainOf(node: El | string, classes: Set<string>): string {
  if (typeof node === "string") return decodeEntities(node);
  if (isHidden(node, classes)) return "";
  if (node.tag === "br") return " ";
  return node.children.map((c) => plainOf(c, classes)).join("");
}

/**
 * The bold, italic, underlined, struck-through and code runs of an email's HTML, worked out when the
 * email arrives because the HTML is not stored. The bubble finds them again in its plain text
 * (findEmphasis in the web app) and draws them there, so no HTML ever reaches the page. A link inside a
 * styled run counts as its label. At most max runs, in document order.
 */
export function emphasisRuns(html: string, max = 300): Emphasis[] {
  if (html.length > MAX_EMPHASIS_HTML) return [];
  try {
    return emphasisRunsOf(html, max);
  } catch {
    return []; // emphasis is decoration: an email it cannot read is stored without it
  }
}

function emphasisRunsOf(html: string, max: number): Emphasis[] {
  const { root, styles } = parseHtml(html);
  const classes = hiddenClasses(styles);
  const out: Emphasis[] = [];
  const walk = (el: El) => {
    for (const c of el.children) {
      if (out.length >= max) return;
      if (typeof c === "string" || isHidden(c, classes)) continue;
      const marks = new Set<Mark>(styleMarks(attr(c.attrs, "style") ?? ""));
      const tagMark = MARK_TAGS[c.tag];
      if (tagMark) marks.add(tagMark);
      if (marks.size) {
        const text = plainOf(c, classes).replace(INVISIBLE, "").replace(SPACES, " ").replace(/\s+/g, " ").trim();
        if (text.length >= 2 && text.length <= 300 && /[\p{L}\p{N}]/u.test(text)) {
          for (const mark of marks) out.push({ text, mark });
        }
      }
      walk(c);
    }
  };
  walk(root);
  return out.slice(0, max);
}

/** cleanText works on at most this many characters: its regexes must stay fast on hostile mail (see cleanText.test). */
const MAX_CLEAN_TEXT = 200_000;

// Marks where a bracketed image or link was removed, so a line left holding only that is dropped
// rather than kept as a blank that splits a sentence in two.
const GONE = "\u0001";
const IMAGE_LINK = "\u0002";

/** Tidies whitespace and link noise without changing the words. */
export function cleanText(text: string): string {
  const raw = (text.length > MAX_CLEAN_TEXT ? text.slice(0, MAX_CLEAN_TEXT) : text)
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .replace(SPACES, " ")
    // Outlook's conditional comments and drawing tags, which some text parts carry verbatim.
    .replace(/<!--[\s\S]{0,20000}?-->|<!\[endif\]-->|<\/?[vwo]:[^>]{0,500}>/gi, "")
    // Preheader padding that a converter left behind as entity names.
    .replace(/&(?:zwnj|zwj|shy|lrm|rlm|#8203|#8204|#8205|#847|#173|#x200[bcd]|#x34f|#xad);/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    // Some senders' converters drop the & and ; and leave the bare name inside a number ("1zwnj000").
    .replace(/(\d)(?:zwnj|zwj|nbsp)(\d)/g, "$1$2")
    // An image in brackets wrapped in a link ("[https://x/logo.png]https://click..."): the image goes and
    // the link is marked, to go too at the top of the email (a logo) and stay below it (a button).
    .replace(/\[(?:https?:\/\/|cid:)[^\]]{0,2000}\](https?:\/\/\S+)/gi, `${GONE}${IMAGE_LINK}$1`)
    // Gmail's text part puts image links, alt text and mailto/tel targets in square brackets.
    .replace(/\[(?:https?:\/\/|cid:|mailto:|tel:)[^\]]{0,2000}\]/gi, GONE)
    .replace(/\[image:[^\]]{0,2000}\]/gi, GONE)
    // Markdown links some senders write: "[Label](https://...)" reads as "Label (https://...)".
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    // A link left as HTML in a text part (GitHub's footers): its label, plus its address when that says more.
    .replace(/<a\s[^>]{0,1000}?href\s*=\s*["']([^"']{0,2000})["'][^>]{0,1000}>([^<]{0,2000})<\/a\s*>/gi, (_: string, href: string, label: string) => {
      const text = label.trim();
      const bare = (u: string) => u.replace(/^(?:https?:\/\/|mailto:)/i, "").replace(/\/$/, "");
      if (!text || bare(text) === bare(href) || !/^(?:https?:\/\/|mailto:)/i.test(href)) return text || href;
      return `${text} (${href})`;
    })
    // Outlook repeats an address after itself: "jo@x.com<mailto:jo@x.com>", "+27 21 ... <tel:+27...>".
    .replace(/[ \t]?<(?:mailto|tel):[^>\s]{1,500}>/gi, "")
    // "( https://... )" and "<https://...>" are how HTML to text converters write links. A link written
    // as "url <url/>" keeps one copy.
    .replace(/\(\s{0,50}(https?:\/\/[^\s)]{1,2000})\s{0,50}\)/g, "($1)")
    .replace(/(\S{0,500})[ \t]{0,50}<(https?:\/\/[^\s>]{1,2000})>/g, (match: string, before: string, url: string, at: number, all: string) => {
      if (before.replace(/\/$/, "") === url.replace(/\/$/, "")) return before;
      const next = all[at + match.length] ?? "";
      return `${before} ${url}${next && !/[\s.,;:!?)]/.test(next) ? " " : ""}`;
    })
    // Link text run into its address ("Registrationhttps://...", "7700https://") when a converter drops the space.
    .replace(/([\p{L}\p{N})\]])(https?:\/\/)/gu, "$1 $2")
    // A link in brackets run into the next label: "(https://...)Help center".
    .replace(/(\(https?:\/\/[^\s)]+\))(?=\p{L})/gu, "$1 ")
    // Picture addresses left in a text part say nothing.
    .replace(/(^|\s)https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?\S*)?(?=\s|$)/gim, "$1");
  const lines: string[] = [];
  for (const rawLine of raw.split("\n")) {
    let line = rawLine.replace(/^[ \t]+|[ \t]+$/g, "").replace(/[ \t]{2,}/g, " ");
    if (line.includes(IMAGE_LINK)) {
      // Only the first, before any text, is taken for the sender's logo.
      let logo = !lines.some((l) => l);
      line = line.replace(new RegExp(`${IMAGE_LINK}(\\S+)`, "g"), (_, url: string) => { const drop = logo; logo = false; return drop ? "" : url; });
    }
    if (line.includes(GONE)) {
      line = line.replaceAll(GONE, "").trim();
      // A removed picture that sat between paragraphs keeps the break; one inside a sentence does not.
      if (!line) { if (/[.!?:]$/.test(lines[lines.length - 1] ?? "")) lines.push(""); continue; }
    }
    line = line
      // A link arrow ("> https://...") that is not quoted history.
      .replace(/^>[ \t]*(https?:\/\/\S+)$/, "$1")
      // Heading markers ("** Title **"), **bold**, Gmail's *bold* and asterisks left on their own.
      .replace(/^\*\*\s+|\s+\*\*$/g, "")
      .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
      .replace(/(^|[\s(])\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*(?=$|[\s.,:;!?)])/g, "$1$2")
      .replace(/(\S)[ \t]+\*+(?=[ \t]|$)/g, "$1")
      // An Outlook separator run into the line after it ("____ Microsoft Teams meeting").
      .replace(/^_{10,}[ \t]*(?=[^\s_])/, "");
    // Rows of stars, equals signs or dashes that converters draw between sections.
    if (/^[*=~#-]{3,}$/.test(line)) line = "";
    // Alt text or an unfilled template left on its own line ("Google Logo", "{text.developer}"), stray
    // brackets ("<>"), and Zendesk's "##- Please type your reply above this line -##".
    if (PLACEHOLDER.test(line) || /^(?:<>|\[\]|\{\}|\|)$/.test(line) || /^\{[\w.$ ]+\}$/.test(line) || /^##-.*-##$/.test(line)) continue;
    // A bullet left on a line of its own belongs to the next line.
    const prev = lines[lines.length - 1];
    if (prev !== undefined && /^[*•-]$/.test(prev) && line) { lines[lines.length - 1] = `• ${line}`; continue; }
    // A short line repeated straight after itself (a logo's alt text, then the heading).
    const last = [...lines].reverse().find((l) => l);
    if (line && line === last && line.length <= 60) continue;
    lines.push(line);
  }
  // A tracking hash some senders leave as the very last line. Only there: a commit hash or checksum
  // someone sends on its own line in the middle of a message stays.
  let end = lines.length;
  while (end > 0 && !lines[end - 1]) end--;
  if (end > 0 && /^[0-9a-f]{32,}$/i.test(lines[end - 1])) lines.splice(end - 1, 1);
  return unwrap(lines).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const PLACEHOLDER = /^(?:\[[^\]\n]{0,40}\b(?:logo|icon|image|img|picture|photo|spacer|banner)\b[^\]\n]{0,40}\]|(?:[\w&'.-]+ )?(?:logo|icon|image|img|picture|photo|spacer|banner))$/i;

// Lines that start something new, so a hard-wrapped paragraph never runs into them.
const STARTS_BLOCK = /^(?:[>*•+-](?:\s|$)|\d{1,2}[.)]\s|On .+|From:|Sent:|To:|Date:|Subject:|-- ?$|_{5,})/;

/**
 * Joins text wrapped at a fixed width (often 72 to 78 characters), which reads raggedly in a narrow bubble.
 * When most lines are that width, any long line runs into the next. Otherwise only a line cut mid-sentence
 * is joined: one of 40 to 160 characters, not ending a sentence, followed by a line starting in lower case.
 * Lines with a link in them do not count against the width, as an address can run long in wrapped text,
 * and nothing is joined onto a line that ends in a link, where the next sentence starts.
 */
function unwrap(lines: string[]): string[] {
  const filled = lines.filter((l) => l.length > 0);
  const wide = filled.filter((l) => l.length >= 60 && l.length <= 80).length;
  const over = filled.filter((l) => l.length > 80 && !/https?:\/\//.test(l)).length;
  const wrapped = filled.length >= 6 && wide >= filled.length * 0.3 && over <= filled.length * 0.05;
  const out: string[] = [];
  let lastLen = 0;
  for (const line of lines) {
    const prev = out[out.length - 1];
    const afterLink = /https?:\/\/\S+$/.test(prev ?? "");
    const joins = !/^[ \t]*_{5,}[ \t]*$/.test(prev ?? "") && (afterLink
      // Only the end of a sentence cut off after a link: "remove <url>" then "it."
      ? /^[a-z]/.test(line) && line.split(/\s+/).length <= 3 && /[.!?]$/.test(line)
      : wrapped
        ? lastLen >= 55 && !prev?.endsWith(":")
        : lastLen >= 40 && lastLen <= 160 && !/[.!?:;)]$/.test(prev ?? "") && /^[a-z]/.test(line) && (/\s/.test(line) || /^[a-z]+[.!?]$/.test(line)));
    if (prev && line && joins && !/^>/.test(prev) && !STARTS_BLOCK.test(line)) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
    lastLen = line.length;
  }
  return out;
}

/** True when a text part is missing or clearly worse than text taken from the HTML part would be. */
export function weakText(text: string): boolean {
  const t = text.replace(INVISIBLE, "").replace(SPACES, " ").trim();
  if (t.length < 3) return true;
  // Style rules or tags that leaked out of the HTML.
  if (/<!--\[if|<v:\w+|@media\b|!important|\{[^{}\n]*[a-z-]+\s*:\s*[^{}\n;]+;[^{}\n]*\}/i.test(t)) return true;
  if ((t.match(/<\/?(?:div|span|table|tr|td|p|br|img|a|font|center|strong|b)\b[^>]*>/gi) ?? []).length >= 3) return true;
  if ((t.match(/&(?:#\d{2,7}|#x[0-9a-f]{2,6}|[a-z]{2,8});/gi) ?? []).length >= 3) return true;
  // "Text version of this email is not supported": the sender only really wrote the HTML.
  if (/text version (?:of this (?:e-?mail|message) )?(?:is )?not (?:supported|available)|(?:does not|doesn't|cannot) (?:support|display) html/i.test(t.slice(0, 300))) return true;
  // A text part that opens with the footer ("This email was intended for", "Unsubscribe") has lost its content.
  const first = t.split("\n").find((l) => /[\p{L}\p{N}]/u.test(l)) ?? "";
  if (FOOTER.test(first.replace(URL_RE, ""))) return true;
  // One run-on line: an HTML stripper wrote it, not a person.
  if (t.length > 1200 && !t.includes("\n")) return true;
  // Link soup: tracking addresses make up much of the text.
  const urls = t.match(URL_RE) ?? [];
  return urls.length >= 8 && urls.join("").length > t.length * 0.3;
}

/** The text to show for an email: its text part when that is good, otherwise text taken from its HTML. */
export function bodySource(text: string | null, html: string | null): string {
  const plain = text ?? "";
  if (!html || !weakText(plain)) return plain;
  const derived = htmlToText(html);
  return /[\p{L}\p{N}]/u.test(derived) || !plain.trim() ? derived : plain;
}

/**
 * Newsletters and marketing mail: an unsubscribe link plus a link or image heavy layout. Their text is
 * shown as a short preview and the original layout is the main way to read them.
 */
export function isBulkMail(html: string | null | undefined): boolean {
  if (!html) return false;
  if (!/unsubscribe|opt[ -]?out|(?:manage|update|change) (?:your |my )?(?:email |e-mail |subscription |communication |notification |marketing )?(?:preferences|settings|subscriptions?)|email preferences/i.test(html)) return false;
  return (html.match(/<a\s[^>]*href/gi) ?? []).length >= 6 || (html.match(/<img\b/gi) ?? []).length >= 4;
}

const FOOTER = /unsubscribe|opt[ -]?out\b|(?:manage|update|change) (?:your |my )?(?:email |e-mail |subscription |communication |notification |marketing )?(?:preferences|settings|subscriptions?)|you(?:'|’)?re receiving this|you are receiving this|(?:this|the) (?:e-?mail|message) (?:was|has been) sent|no longer (?:wish|want) to receive|add us to your address book|all rights reserved|(?:this|the) (?:e-?mail|message) (?:was|is) (?:intended|meant) for|legal notice|^(?:©|\(c\)|copyright\b)/i;

/** Splits the unsubscribe, address and copyright footer off a newsletter so the bubble leads with the content. */
export function splitFooter(text: string): EmailParts {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (offset >= text.length * 0.4 && FOOTER.test(lines[i])) {
      const body = lines.slice(0, i).join("\n").trim();
      const quoted = lines.slice(i).join("\n").trim();
      return body ? { body, quoted } : { body: text };
    }
    offset += lines[i].length + 1;
  }
  return { body: text };
}

// "View this email in your browser" and friends lead many newsletters and say nothing.
const BROWSER_LINE = /view (?:this |the |it |our )?(?:e-?mail |message |newsletter )?(?:in|on|online|as a web ?page)|(?:can(?:'|’)?t|cannot|unable to|trouble|problems?) (?:see|view|read|display|viewing|seeing)|open (?:it |the following (?:url|link) )?in (?:your |a )?browser|web version|online version/i;

/** A menu row such as "Women | Men | Kids | Sale". */
function isNavLine(line: string): boolean {
  const items = line.split(/\s+[|·•]\s+/);
  return items.length >= 3 && items.every((s) => s.trim().split(/\s+/).length <= 3);
}

function clip(line: string, room: number): string {
  const cut = line.lastIndexOf(" ", Math.max(room, 40));
  return `${line.slice(0, cut > 20 ? cut : Math.max(room, 40)).replace(/[\s,.;:]+$/, "")}…`;
}

/**
 * A short, clean opening for a newsletter bubble: no addresses, menus or "view in browser" lines, cut to a
 * few lines. more says whether the full text has anything the preview left out.
 */
export function bulkPreview(text: string, max = 320): { text: string; more: boolean } {
  const out: string[] = [];
  let used = 0;
  let more = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\(\s*https?:\/\/[^\s)]*\s*\)/g, "").replace(URL_RE, "").replace(/\s{2,}/g, " ").trim();
    if (line !== raw.trim()) more = true;
    if (!/[\p{L}\p{N}]/u.test(line)) {
      if (out.length && out[out.length - 1]) out.push("");
      continue;
    }
    if ((BROWSER_LINE.test(line) && line.length < 120) || isNavLine(line) || (FOOTER.test(line) && line.length < 160)) { more = true; continue; }
    if (used >= max || out.filter(Boolean).length >= 6) { more = true; break; }
    if (line.length > max - used + 40) {
      out.push(clip(line, max - used));
      more = true;
      break;
    }
    out.push(line);
    used += line.length;
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return { text: out.join("\n"), more };
}

// Where quoted history or a signature starts. Each needs at least one line of new text before it.
const CUTS = [
  /\n[ \t]*On [^\n]*(?:\n[^\n]*)?wrote:[ \t]*\n/, // "On Tue, ... James wrote:" (sometimes wrapped)
  /\n[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}/i,
  /\n[ \t]*\*?From:\*? [^\n]+\n[ \t]*\*?(?:Sent|Date):/, // Outlook-style reply header
  /\n-- ?\n/, // signature delimiter
  /\n[ \t]*_{10,}[ \t]*\n(?![ \t]*Microsoft Teams)/, // Outlook reply separator, but not the line above a Teams invite
  /\n[ \t]*(?:Get Outlook for|Sent from my|Sent from Outlook|Sent from Mail for) [^\n]*/i, // mobile app footers
  /\n[^\n]{2,80}\n[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}(?: [AP]M)? GMT[+-]\d{1,2}(?::\d{2})?\n/, // Zendesk ticket history
];

const QUOTE_LINE = /^[ \t]*>(?![ \t]*https?:\/\/\S+[ \t]*$)/;

/** Where a trailing block of "> " lines starts (index of the newline before it), or -1. Quotes with answers after
 * them (an interleaved reply) are not trailing, so those answers are not hidden. */
function trailingQuote(text: string): number {
  const lines = text.split("\n");
  let start = -1; // index of the first quoted line of the final run
  for (let i = lines.length - 1; i > 0; i--) {
    if (!lines[i].trim()) continue;
    if (/^[ \t]*>/.test(lines[i])) { if (QUOTE_LINE.test(lines[i])) start = i; continue; }
    break;
  }
  if (start < 1) return -1;
  let at = 0;
  for (let i = 0; i < start; i++) at += lines[i].length + 1;
  return at - 1;
}

// A forwarded email's own content follows this line, so nothing after it is cut as history.
const FORWARD = /^[ \t]*(?:-{3,}[ \t]*Forwarded message[ \t]*-{3,}|Begin forwarded message:)/im;

/** Splits new text from quoted history. When nothing new comes first, everything stays in the body. */
export function splitQuoted(text: string): EmailParts {
  const forward = FORWARD.exec(text)?.index ?? Infinity;
  let cut = -1;
  for (const pattern of CUTS) {
    const match = pattern.exec(text);
    if (match && match.index > 0 && match.index < forward && (cut < 0 || match.index < cut)) cut = match.index;
  }
  const quote = trailingQuote(text);
  if (quote > 0 && quote < forward && (cut < 0 || quote < cut)) cut = quote;
  if (cut < 0) return { body: text };
  const body = text.slice(0, cut).trim();
  const quoted = text.slice(cut).trim();
  // A reply that is only quoted lines has no new text to lead with.
  if (!body || body.split("\n").every((line) => /^\s*(>|$)/.test(line))) return { body: text };
  return quoted ? { body, quoted } : { body };
}

// A closing such as "Kind regards," on a line of its own, followed by the sender's name.
const SIGN_OFF = /^(?:(?:kind|best|warm|warmest|many|with) )?(?:regards|thanks|thank you|thanks again|many thanks|cheers|best|sincerely|yours sincerely|yours faithfully|yours truly|all the best|best wishes|warm wishes|take care|speak soon|talk soon|love)[,.!]?$/i;
// Phone numbers: international ("+27 82 ..."), labelled ("Tel: 021 ..."), or a ten-digit local number.
// Not bare digit runs, which are as often meeting IDs, account numbers or parts of a link.
const PHONE = /\+\d{1,3}[\d ()-]{6,}\d|\b(?:tel|phone|fax|mobile|cell|call(?: us)?(?: on)?)\b[^\d\n]{0,12}\d[\d ()-]{6,}\d|(?<![\d-])0\d{2}[ -]?\d{3}[ -]?\d{4}(?![\d-])/i;
// Lines that end an email rather than say anything: legal notices, contact lines, app footers and the like.
const LEGALISH = /^\[[A-Za-z][A-Za-z &]{1,24}\](?:\s|$)|^\[[^\]\n]{1,40}\]\s*\[|\b(?:tel|phone|fax|mobile|cell)\b\s*[:.]|\bp\.?\s?o\.?\s?box\b|\bdisclaimer\b|confidential|privileged|\blegal\b|privacy|\bterms\b|copyright|©|\(c\) ?\d{4}|all rights reserved|trademark|\bregistered\b|\bvat\b|unsubscribe|do not reply|don(?:'|’)t reply|you(?:'|’)?(?:re|ve| are| have)? receiv\w* (?:this|these)\b|you(?:'|’)?re receiving \w+(?: \w+)? (?:e-?mails?|notifications)|(?:this|the) (?:\w+ )?(?:e-?mail|message) (?:was|is|and)\b|intended (?:only )?for|equal opportunity|follow us|member of|personal information|data protection|\bpopia?\b|\bgdpr\b|registration (?:number|no)|managing directors?|powered by|sent via|our e-?mails are sent|^get \w+ for:|^sent by [\w ]{1,30}$|questions or feedback|why we included this|refer a friend|was this (?:e-?mail |information )?helpful|get the \w+ app|visit \S.{0,40} on (?:linkedin|twitter|github|facebook|instagram|youtube)|(?:contact|reach) us (?:through|via|at) our help cent(?:er|re)|need help\?|empowerment contributor|b-?bbee|legal notice|\b(?:pty|ltd|inc|llc|gmbh|plc|pbc|corporation)\b|\bAB\b/i;
// A postal address: a street with a number, a US state and ZIP, or a line of three or more comma-separated
// parts with a number in it ("Spotify AB, Regeringsgatan 19, 111 53, Stockholm, Sweden").
const STREET = /\b\d+[\w .'-]{0,40}\b(?:street|st|road|rd|avenue|ave|drive|dr|square|parkway|pkwy|highway|hwy|boulevard|blvd|crescent|lane|way|place|suite|ste|pmb|floor)\b\.?(?:,|\s|$)|\b[A-Z]{2} \d{5}\b/;
function isAddress(line: string): boolean {
  if (STREET.test(line)) return true;
  const parts = line.split(",");
  return parts.length >= 3 && /\d/.test(line) && line.split(/\s+/).length <= 14 && !/[.!?]$/.test(line);
}
// A Teams or Zoom invite's details, whose long numbers are not phone numbers to cut.
const MEETING = /\b(?:meeting|conference|webinar) id\b|passcode|^join\b/i;
// Contact details in a signature: links, addresses and the above.
const FOOTERISH = new RegExp(`https?:\\/\\/|www\\.|@[\\w-]+\\.|website|newsletter|south africa|${LEGALISH.source}`, "i");
const URL_ONLY = /^\S*(?:https?:\/\/|www\.)\S*$/;
const withoutLinks = (line: string) => line.replace(/https?:\/\/\S+/g, " ").trim();

// Words that make even a long line a footer.
const STRONG_LEGAL = /unsubscribe|all rights reserved|confidential|disclaimer|privileged|do not reply|don(?:'|’)t reply|intended (?:only )?for|copyright|©|\bgdpr\b|\bpopia?\b|privacy (?:policy|notice)|in accordance with (?:the )?(?:applicable|gdpr|popia|data)/i;

/**
 * A line that belongs to an email's footer: a legal or contact line, an address or a phone number. A
 * long line, or one with an amount of money in it, counts only on strong legal words, so a receipt line
 * naming "Anthropic, PBC" or "VAT" stays.
 */
function isFooterLine(line: string): boolean {
  const t = withoutLinks(line);
  if (!t || MEETING.test(t)) return false;
  if (t.length > 160 || /[$€£]\s?\d|\bR\s?\d+(?:[.,]\d{2})\b/.test(t)) return STRONG_LEGAL.test(t);
  return LEGALISH.test(t) || PHONE.test(t) || isAddress(t);
}

function isSignatureLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (MEETING.test(t)) return false;
  return FOOTERISH.test(t) || PHONE.test(withoutLinks(t)) || isAddress(withoutLinks(t)) || (t.split(/\s+/).length <= 6 && !/[?]$/.test(t));
}

/**
 * Splits a signature and footer off the end of a person's email.
 *
 * After a closing such as "Regards" and the name under it, the rest goes when it reads as a signature:
 * contact details, titles and legal lines, allowing one stray line (a "Write us a review" link) among
 * several. A line starting "P.S." always stays.
 *
 * With no closing, a trailing run of footer lines goes (legal text, addresses, phone numbers), with the
 * links and short labels between them. The run may step over up to two longer lines when a footer line
 * sits just above them ("Learn why we included this"), but links above the first footer line stay, as
 * they may be what the email is about.
 */
export function trimSignature(text: string): EmailParts {
  const lines = text.split("\n");
  let end = lines.length;
  for (let i = lines.length - 1; i > 0; i--) {
    if (!SIGN_OFF.test(lines[i].trim())) continue;
    // The name may sit a blank line below the closing.
    const at = lines[i + 1]?.trim() ? i + 1 : lines[i + 2]?.trim() ? i + 2 : -1;
    const name = at > 0 ? lines[at].trim() : "";
    const keep = name && name.length <= 40 && !FOOTERISH.test(name) && !PHONE.test(name) ? at + 1 : i + 1;
    const tail = lines.slice(keep).filter((l) => l.trim());
    const odd = tail.filter((l) => !isSignatureLine(l)).length;
    const signature = tail.length > 0 && !tail.some((l) => /^p\.?\s?s\b/i.test(l.trim()))
      && (odd === 0 || (odd === 1 && tail.length >= 3 && tail.some(isFooterLine)));
    if (signature) end = keep;
    break;
  }
  if (end === lines.length) {
    let i = lines.length - 1;
    let cut = lines.length;
    let stepped = 0;
    while (i >= 1) {
      const line = lines[i].trim();
      if (!line) { i--; continue; }
      if (isFooterLine(line)) { cut = i; stepped = 0; i--; continue; }
      if (URL_ONLY.test(line) || withoutLinks(line).split(/\s+/).length <= 4) { i--; continue; }
      const crossable = /https?:\/\//.test(line) || line.split(/\s+/).length < 8;
      if (crossable && stepped < 2 && cut < lines.length && lines.slice(Math.max(0, i - 3), i).some(isFooterLine)) { stepped++; i--; continue; }
      break;
    }
    end = cut;
  }
  const body = lines.slice(0, end).join("\n").trim();
  const footer = lines.slice(end).join("\n").trim();
  return body && footer ? { body, quoted: footer } : { body: text };
}

const BROWSER_TOP = /\bbrowser\b|web version|online version|view (?:this |the )?(?:e-?mail|message|newsletter) (?:online|in|on)\b/i;

/**
 * Removes a "View in your browser" line from the top of an email, where it only points at the original.
 * Outside bulk mail the line must be short, read like that stock phrase and not open with a greeting, so
 * a person's "Hi Sam, open it in your browser: <link>" stays.
 */
function dropBrowserLine(text: string, bulk: boolean): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trim());
  if (i < 0 || i > 2 || lines[i].replace(URL_RE, "").length >= 120 || !BROWSER_TOP.test(lines[i])) return text;
  const words = lines[i].replace(URL_RE, "").trim();
  if (!bulk && (words.length >= 60 || !BROWSER_LINE.test(words) || /^(?:hi|hello|hey|dear|morning|afternoon|evening)\b/i.test(words))) return text;
  // Only a line that is itself a link, or is followed by its address, so a person's "open it in your browser" stays.
  const next = lines[i + 1]?.trim() ?? "";
  const link = /https?:\/\//.test(lines[i]) ? 1 : /^https?:\/\/\S+$/.test(next) ? 2 : 0;
  return link ? lines.slice(i + link).join("\n").trim() || text : text;
}

/** The email inside a forward: its header fields as written and its own text. */
export interface ForwardedEmail {
  /** "Name <address>" or an address. */
  from?: string;
  date?: string;
  subject?: string;
  to?: string;
  body: string;
}

const HEADER_LINE = /^[ \t]*\*?(From|Sent|Date|Subject|To|Cc)\*?:[ \t]*(.*)$/i;
const ORIGINAL = /^[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}[ \t]*$/i;

/** The header block starting at line i (From, Date or Sent, Subject, To, Cc in any order), or null. */
function readHeader(lines: string[], i: number): { fields: Omit<ForwardedEmail, "body">; next: number } | null {
  const fields: Record<string, string> = {};
  let j = i;
  for (; j < lines.length; j++) {
    const m = HEADER_LINE.exec(lines[j]);
    if (!m) break;
    const key = m[1].toLowerCase() === "sent" ? "date" : m[1].toLowerCase();
    if (key !== "cc" && !fields[key]) fields[key] = m[2].trim();
  }
  if (!fields.from || !(fields.date || fields.subject)) return null;
  return { fields, next: j };
}

/** Where a header block starts at or after line i: a From line with Date, Sent or Subject just below. */
function headerAt(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (/^[ \t]*\*?From\*?:/i.test(lines[i]) && lines.slice(i + 1, i + 4).some((l) => /^[ \t]*\*?(?:Sent|Date|Subject)\*?:/i.test(l))) return i;
  }
  return -1;
}

/**
 * Splits a forwarded email into the forwarder's note and the email they forwarded, in the three forms
 * mail apps write: Gmail's "---------- Forwarded message ---------" and Apple's "Begin forwarded
 * message:" banners, Outlook's "____" line then a From/Sent block in an email whose subject starts
 * "Fw:", and Apple Mail's banner-less form where every line starts "> " and opens with "> From:".
 * A forwarded email that itself opens with an "Original Message" header loses that header too, and its
 * own quoted history, signature and footer are split off as in any email.
 */
export function splitForward(text: string, subject?: string): EmailParts | null {
  let lines = text.split("\n");
  let start = -1;
  let note = "";
  const quotedHead = lines.slice(0, 6).filter((l) => /^>/.test(l));
  if (/^>[ \t]*\*?From\*?:/i.test(lines.find((l) => l.trim()) ?? "") && quotedHead.some((l) => /^>[ \t]*\*?(?:Subject|Date)\*?:/i.test(l))) {
    lines = lines.map((l) => l.replace(/^>[ \t]?/, ""));
    start = lines.findIndex((l) => l.trim());
  } else {
    const banner = lines.findIndex((l) => FORWARD.test(l));
    if (banner >= 0) {
      note = lines.slice(0, banner).join("\n");
      start = headerAt(lines, banner + 1);
      if (start > banner + 3) start = -1;
    } else if (subject && /^\s*(?:fwd?|fw)\s*:/i.test(subject)) {
      start = headerAt(lines, 0);
      // The "____" line Outlook draws above the header belongs to neither part.
      if (start >= 0) note = lines.slice(0, start).join("\n").replace(/\n?[ \t]*_{5,}[ \t]*\s*$/, "");
    }
  }
  if (start < 0) return null;
  const header = readHeader(lines, start);
  if (!header) return null;
  let rest = lines.slice(header.next);
  // A forward of a forward or reply: the inner "Original Message" header goes, keeping its text.
  const firstText = rest.findIndex((l) => l.trim());
  if (firstText >= 0 && (ORIGINAL.test(rest[firstText]) || headerAt(rest, firstText) === firstText)) {
    const inner = readHeader(rest, ORIGINAL.test(rest[firstText]) ? firstText + 1 : firstText);
    if (inner) rest = rest.slice(inner.next);
  }
  const forwarded = rest.join("\n").trim();
  const own = trimSignature(splitQuoted(forwarded).body).body;
  const said = note.trim() ? trimSignature(splitQuoted(note.trim()).body).body : "";
  return { body: said, forward: { ...header.fields, body: own } };
}

// A Zendesk reply opens with the agent's name and the date before what they wrote.
const ZENDESK_TOP = /^[^\n]{2,80}\n[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}(?: [AP]M)? GMT[+-]\d{1,2}(?::\d{2})?\n+/;

/**
 * Bubble text for a stored email: its text part or HTML as text, cleaned, with history or footer split
 * off. A forward is split into the note and the forwarded email (the subject tells Outlook's apart).
 */
export function emailParts(text: string | null, html: string | null, subject?: string | null, storedBulk = false): EmailParts {
  // The HTML is no longer stored, so the sync worker records whether an email is bulk as it arrives.
  const bulk = storedBulk || isBulkMail(html);
  const cleaned = dropBrowserLine(cleanText(bodySource(text, html)), bulk).replace(ZENDESK_TOP, "");
  if (bulk) return { ...splitFooter(cleaned), bulk: true };
  const forward = splitForward(cleaned, subject ?? undefined);
  if (forward) return forward;
  const reply = splitQuoted(cleaned);
  const signed = trimSignature(reply.body);
  const quoted = [signed.quoted, reply.quoted].filter(Boolean).join("\n\n");
  // A separator line left at either end (above a Teams invite, say) frames nothing.
  const framed = signed.body.replace(/^(?:[ \t]*_{5,}[ \t]*\n+)+/, "").replace(/(?:\n+[ \t]*_{5,}[ \t]*)+$/, "");
  // Nothing but empty quote markers is an empty email.
  const body = /^[>\s]*$/.test(framed) ? "" : framed;
  return quoted ? { body, quoted } : { body };
}

/** "https://www.example.com/news/2024/item?utm=x" becomes "example.com/news/…". */
export function shortenUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    const bare = url.replace(/^https?:\/\//, "");
    return bare.length > 40 ? `${bare.slice(0, 37)}…` : bare;
  }
  const host = u.host.replace(/^www\./, "");
  const segments = u.pathname.split("/").filter(Boolean);
  const first = segments[0] ? (segments[0].length > 24 ? `${segments[0].slice(0, 20)}…` : segments[0]) : "";
  const more = segments.length > 1 || !!u.search || !!u.hash;
  // Long tracking hosts leave no room for a path.
  if (!first || host.length + first.length > 40) return more || first ? `${host}/…` : host;
  return more ? `${host}/${first}/…` : `${host}/${first}`;
}

/** "https://click.e.brand.co.za/x" becomes "brand.co.za", the site a link belongs to. */
export function siteOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return shortenUrl(url);
  }
  const labels = host.replace(/^www\./, "").split(".");
  if (labels.length < 3 || /^\d+$/.test(labels[labels.length - 1])) return labels.join(".");
  // Country endings such as co.za and com.au keep one more label.
  const keep = labels[labels.length - 1].length === 2 && labels[labels.length - 2].length <= 3 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

const URL_RE = /https?:\/\/[^\s<>"'\[\]]+/g;

/** Trailing punctuation belongs to the sentence, not the link, unless it closes a bracket inside the URL. */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (/[.,;:!?'"]/.test(ch)) { end--; continue; }
    if (ch === ")") {
      const s = url.slice(0, end);
      if ((s.match(/\(/g) ?? []).length < (s.match(/\)/g) ?? []).length) { end--; continue; }
    }
    break;
  }
  return url.slice(0, end);
}

/** Splits text into plain runs and links. With shorten, link labels become host plus a short path. */
export function linkParts(text: string, shorten = true): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const href = trimUrl(match[0]);
    if (!/^https?:\/\/[^/\s]+\.[^/\s]/.test(href)) continue;
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start) });
    // "Shop Now (https://click.brand.com/...)": the label already says what it is, so the link shows just its site.
    const wrapped = shorten && text[start - 1] === "(" && text[start + href.length] === ")";
    parts.push({ href, label: wrapped ? siteOf(href) : shorten ? shortenUrl(href) : href.replace(/^https?:\/\//, "") });
    last = start + href.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

// Remote content stays off until asked for. Scripts, frames, forms and fonts never load.
function csp(allowImages: boolean) {
  return [
    "default-src 'none'",
    `img-src data:${allowImages ? " https:" : ""}`,
    "style-src 'unsafe-inline'",
    "font-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const REMOTE_IMAGE = /<(?:img|image)\b[^<>]*?(?:https?:)?\/\/|url\(\s*(?:["']|&quot;|&#39;)?\s*(?:https?:)?\/\/|\sbackground\s*=\s*["']?\s*(?:https?:)?\/\//i;

export interface OriginalDoc {
  srcdoc: string;
  /** How many remote images were blocked, so the viewer knows whether to offer Load Images. */
  blocked: number;
}

/**
 * A standalone document for an <iframe sandbox srcdoc>. The sandbox and CSP do the real work; stripping
 * active tags and remote image sources here is a second layer and stops trackers firing on open.
 */
/** The viewer shows at most this much of one email's HTML: the stripping below must stay quick on hostile input. */
const MAX_ORIGINAL_HTML = 2_000_000;
// A tag's text must end in ">" in the same match: unlike a "[^>]*>" pattern, which tries every "<img" in a
// run of unfinished ones and reads on to the end each time, this refuses a tag that holds another "<".
const IMG_TAG = /<img\b[^<>]*>/gi;
const BLOCK_TAGS = new Set(["script", "iframe", "object", "embed", "noscript", "title"]);
const BARE_TAGS = new Set(["meta", "base", "link"]);

/**
 * Removes <script>, <iframe>, <object>, <embed>, <noscript> and <title> elements with their content, and
 * <meta>, <base> and <link> tags, in one pass. An element that never closes loses only its opening tag, and
 * a tag that never ends takes the rest of the document with it (a pattern that backtracks over each of many
 * such tags is quadratic).
 */
function stripBlocks(html: string): string {
  const lower = html.toLowerCase();
  const out: string[] = [];
  const noClose = new Set<string>();
  let copied = 0;
  let at = 0;
  for (let lt = html.indexOf("<", at); lt >= 0; lt = html.indexOf("<", at)) {
    at = lt + 1;
    const m = /^<([a-z]+)\b/.exec(lower.slice(lt, lt + 12));
    if (!m || !(BLOCK_TAGS.has(m[1]) || BARE_TAGS.has(m[1]))) continue;
    out.push(html.slice(copied, lt));
    const name = m[1];
    let close = -1;
    if (BLOCK_TAGS.has(name) && !noClose.has(name)) {
      close = lower.indexOf(`</${name}`, lt + 1);
      if (close < 0) noClose.add(name);
    }
    const gt = html.indexOf(">", close < 0 ? lt : close);
    if (gt < 0) return out.join("");
    copied = at = gt + 1;
  }
  out.push(html.slice(copied));
  return out.join("");
}

export function originalDoc(html: string, allowImages: boolean): OriginalDoc {
  let blocked = 0;
  let body = stripBlocks(html.length > MAX_ORIGINAL_HTML ? html.slice(0, MAX_ORIGINAL_HTML) : html)
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1=""');
  if (!allowImages) {
    body = body
      .replace(IMG_TAG, (tag) =>
        tag
          .replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
          .replace(/\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (attr, value: string) => {
            // Only remote sources are blocked and counted. cid: and the like never load in the frame anyway.
            if (!/^["']?\s*(?:https?:)?\/\//i.test(value)) return attr;
            blocked++;
            return ' src=""';
          }),
      )
      .replace(/\sbackground\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/url\(\s*(["']?)\s*(?:https?:)?\/\/[^()]*\)/gi, "url()");
    // Remote images in forms the rewrite above misses are still stopped by the CSP; count them so Load Images shows.
    if (blocked === 0 && REMOTE_IMAGE.test(html)) blocked = 1;
  }
  const head = [
    "<!doctype html><html><head>",
    `<meta http-equiv="Content-Security-Policy" content="${csp(allowImages)}">`,
    '<meta charset="utf-8"><meta name="referrer" content="no-referrer">',
    '<base target="_blank">',
    "<style>:root{color-scheme:light}html{background:Canvas;color:CanvasText}body{margin:0;padding:16px;font-family:system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>",
    "</head><body>",
  ].join("");
  return { srcdoc: `${head}${body}</body></html>`, blocked };
}
