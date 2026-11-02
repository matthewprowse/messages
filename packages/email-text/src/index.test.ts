// Tests for packages/email-text/src/index.ts. Pin down text cleaning, HTML to text, quote and forward splitting,
// signature trimming, link shortening, the sandboxed original document and newsletter detection and footers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bodySource, bulkPreview, cleanText, decodeEntities, emailParts, htmlToText, isBulkMail, linkParts, originalDoc, shortenUrl, siteOf, splitFooter, splitForward, splitQuoted, trimSignature, weakText } from "./index";

test("cleanText collapses blank runs and invisible padding", () => {
  const out = cleanText("Hi there\r\n\r\n\u00a0\r\n\u200b\u034f \r\n\r\nSecond line   \n\n\n\nThird");
  assert.equal(out, "Hi there\n\nSecond line\n\nThird");
});

test("cleanText drops bracketed image links and tidies converter link styles", () => {
  assert.equal(cleanText("Logo [https://x.com/logo.png] [image: Brand]\nRead ( https://a.com/b )\nSee <https://c.com/d>"), "Read (https://a.com/b)\nSee https://c.com/d");
});

test("splitQuoted splits on On ... wrote:", () => {
  const parts = splitQuoted("Sounds good.\n\nOn Tue, 3 Mar 2026 at 10:00, Sam <s@example.com> wrote:\n> Lunch?");
  assert.equal(parts.body, "Sounds good.");
  assert.match(parts.quoted ?? "", /^On Tue/);
});

test("splitQuoted handles a wrapped On ... wrote: line", () => {
  const parts = splitQuoted("Yes\nOn Tue, 3 Mar 2026 at 10:00, Sam Smith\n<s@example.com> wrote:\nold");
  assert.equal(parts.body, "Yes");
});

test("splitQuoted handles Outlook headers and Original Message", () => {
  assert.equal(splitQuoted("Thanks\nFrom: Sam\nSent: Monday\nTo: Me\nold").body, "Thanks");
  assert.equal(splitQuoted("Thanks\n-----Original Message-----\nold").body, "Thanks");
  assert.equal(splitQuoted("Thanks\n*From:* Sam\n*Sent:* Monday").body, "Thanks");
});

test("splitQuoted takes the earliest marker and keeps signatures behind it", () => {
  const parts = splitQuoted("See you then\n-- \nSam\nOn Mon, Bob wrote:\n> hi");
  assert.equal(parts.body, "See you then");
  assert.equal(parts.quoted, "-- \nSam\nOn Mon, Bob wrote:\n> hi");
});

test("splitQuoted keeps everything when nothing new comes first", () => {
  assert.deepEqual(splitQuoted("> only quoted\n> text"), { body: "> only quoted\n> text" });
  assert.deepEqual(splitQuoted("Just a note"), { body: "Just a note" });
});

test("emailParts falls back to HTML and never returns an empty body", () => {
  assert.equal(emailParts("", "<p>Hello&nbsp;there</p><p>Bye &amp; thanks</p>").body, "Hello there\nBye & thanks");
  assert.equal(emailParts(null, null).body, ""); // no placeholder: a sticker or file shows on its own
});

test("htmlToText drops style and script blocks", () => {
  assert.equal(htmlToText("<style>.a{}</style><script>x()</script><div>Hi&#33;</div>").trim(), "Hi!");
});

test("shortenUrl keeps host and a short path", () => {
  assert.equal(shortenUrl("https://www.example.com/"), "example.com");
  assert.equal(shortenUrl("https://example.com/news"), "example.com/news");
  assert.equal(shortenUrl("https://www.example.com/news/2024/item?utm_source=x"), "example.com/news/…");
  assert.equal(shortenUrl("https://click.e.brand.com/?qs=abc123"), "click.e.brand.com/…");
  assert.equal(shortenUrl("https://t.co/abcdefghijklmnopqrstuvwxyz0123"), "t.co/abcdefghijklmnopqrst…");
  assert.equal(shortenUrl("https://links.marketing.some-long-brand-name.co.za/campaign"), "links.marketing.some-long-brand-name.co.za/…");
});

test("linkParts trims sentence punctuation and balances brackets", () => {
  assert.deepEqual(linkParts("Go to https://a.com/x. Then (https://b.com/y) and https://w.org/Foo_(bar)!"), [
    { text: "Go to " },
    { href: "https://a.com/x", label: "a.com/x" },
    { text: ". Then (" },
    { href: "https://b.com/y", label: "b.com" },
    { text: ") and " },
    { href: "https://w.org/Foo_(bar)", label: "w.org/Foo_(bar)" },
    { text: "!" },
  ]);
});

test("linkParts without shortening keeps the full address", () => {
  assert.deepEqual(linkParts("see https://a.com/x/y?z=1", false), [{ text: "see " }, { href: "https://a.com/x/y?z=1", label: "a.com/x/y?z=1" }]);
});

test("originalDoc blocks remote images until allowed", () => {
  const html = '<img src="https://t.example/p.gif" srcset="https://t.example/2x.gif 2x"><img src="data:image/png;base64,AA"><td background="https://x/y.png" style="background:url(https://x/z.png)">';
  const blocked = originalDoc(html, false);
  assert.equal(blocked.blocked, 1);
  assert.doesNotMatch(blocked.srcdoc, /t\.example|x\/y\.png|x\/z\.png/);
  assert.match(blocked.srcdoc, /data:image\/png/);
  assert.match(blocked.srcdoc, /img-src data:;/);
  const allowed = originalDoc(html, true);
  assert.match(allowed.srcdoc, /t\.example\/p\.gif/);
  assert.match(allowed.srcdoc, /img-src data: https:;/);
});

test("originalDoc strips active content", () => {
  const { srcdoc } = originalDoc('<script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://x"><a href="javascript:alert(1)" onclick="x()">a</a><iframe src="https://x"></iframe>', true);
  assert.doesNotMatch(srcdoc, /<script|alert|onclick|<iframe|refresh/i);
  assert.match(srcdoc, /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
});

test("originalDoc counts only remote images it can load", () => {
  assert.equal(originalDoc('<img src="cid:logo@x">', false).blocked, 0);
  assert.equal(originalDoc('<img/src="https://t.example/p.gif">', false).blocked, 1);
  assert.equal(originalDoc('<div style="background:url(&quot;https://x/z.png&quot;)">', false).blocked, 1);
});

// The cases below are synthesised from patterns seen in real newsletters and receipts. No real mail is quoted.

const NEWSLETTER = `<!doctype html><html><head><title>Sale</title>
<style>.preheader{display:none!important} @media (max-width:600px){.desktop{display:none}} td{font-family:Arial}</style>
<!--[if mso]><style>.x{mso-line-height-rule:exactly}</style><![endif]--></head>
<body><span class="preheader">Hidden teaser text&zwnj;&nbsp;&zwnj;&nbsp;&#847;</span>
<div style="display:none;max-height:0;overflow:hidden">Another teaser</div>
<table><tr><td><a href="https://click.e.shop.example/view">View in browser</a></td></tr>
<tr><td><a href="https://click.e.shop.example/home"><img src="https://cdn.shop.example/logo.png" alt="Shop logo" width="120"></a></td></tr>
<tr><td><h1>Spring Sale Starts Now</h1><p>Save up to 40% on everything in store and online this weekend only, while stock lasts.</p>
<p><a href="https://click.e.shop.example/sale?u=1">Shop Now</a></p></td></tr>
<tr><td><a href="https://click.e.shop.example/w">Women</a> | <a href="https://click.e.shop.example/m">Men</a> | <a href="https://click.e.shop.example/k">Kids</a></td></tr>
<tr><td>Running Shoes</td><td>R 1,299.00</td></tr>
<tr><td><p style="font-size:0;line-height:0">.</p></td></tr>
<tr><td class="desktop">Desktop only block</td></tr>
<tr><td><img src="https://t.shop.example/open.gif" width="1" height="1" alt=""></td></tr>
<tr><td style="font-size:12px">You are receiving this email because you signed up. <a href="https://click.e.shop.example/unsub">Unsubscribe</a><br>&copy; 2026 Shop Ltd. All rights reserved.</td></tr>
</table></body></html>`;

test("htmlToText drops head, styles, MSO comments, hidden preheaders and tracking pixels", () => {
  const out = htmlToText(NEWSLETTER);
  assert.doesNotMatch(out, /teaser|font-family|mso-|preheader|Sale\n.*<title>|open\.gif|logo/i);
  assert.doesNotMatch(out, /[\u200b-\u200f\u034f\u00ad]/);
  assert.match(out, /^View in browser \(https:\/\/click\.e\.shop\.example\/view\)/);
  assert.match(out, /Spring Sale Starts Now\n\nSave up to 40% on everything/);
  assert.match(out, /Shop Now \(https:\/\/click\.e\.shop\.example\/sale\?u=1\)/);
});

test("htmlToText keeps short table rows on one line and drops spacer cells", () => {
  const out = htmlToText(NEWSLETTER);
  assert.match(out, /^Running Shoes · R 1,299\.00$/m);
  assert.doesNotMatch(out, /^\.$/m);
  // Media query rules apply only on some screens, so their content stays.
  assert.match(out, /Desktop only block/);
});

test("htmlToText turns lists and headings into lines and keeps paragraph breaks", () => {
  const out = htmlToText("<h2>Agenda</h2><ul><li>Coffee</li><li>Talks<li>Lunch</ul><ol><li>One</li><li>Two</li></ol><p>A longer paragraph that is clearly a real paragraph of prose text.</p><p>Bye</p>");
  assert.equal(out, "Agenda\n\n• Coffee\n• Talks\n• Lunch\n\n1. One\n2. Two\n\nA longer paragraph that is clearly a real paragraph of prose text.\n\nBye");
});

test("htmlToText survives unclosed cells, stray end tags and an unclosed head", () => {
  const out = htmlToText("<html><head><meta charset=utf-8><body><table><tr><td>Total<td>R 50</tr></div></table><p>Thanks<p>Team");
  assert.equal(out, "Total · R 50\nThanks\nTeam");
});

test("htmlToText links: one address per link, none for image-only or repeated links", () => {
  const out = htmlToText('<a href="https://x.example/a"><img src="https://x.example/i.png" alt=""></a><a href="https://x.example/a">Read more</a> <a href="https://x.example/a">Read more</a> <a href="mailto:hi@x.example">Email us</a> <a href="https://www.x.example">www.x.example</a>');
  assert.equal(out, "Read more (https://x.example/a) Read more Email us www.x.example");
});

test("htmlToText keeps alt text that carries words, not alt text naming the picture", () => {
  assert.equal(htmlToText('<img alt="Facebook"><img alt="Brand logo"><img alt="banner.png"><img alt="Fifty percent off all boots">'), "Fifty percent off all boots");
  // Alt text that repeats the visible heading adds nothing.
  assert.equal(htmlToText('<img alt="Winter boots are here"><h1>Winter boots are here</h1>'), "Winter boots are here");
});

test("htmlToText font-size:0 hides text unless a child sets its own size", () => {
  assert.equal(htmlToText('<td style="font-size:0"> gap <div style="font-size:14px">Column</div></td>'), "Column");
});

test("decodeEntities handles numeric and named references and leaves query strings alone", () => {
  assert.equal(decodeEntities("Caf&eacute; &#8217;s &#x2122; &amp; ?a=1&copy=2 &unknown;"), "Café ’s ™ & ?a=1&copy=2 &unknown;");
});

test("cleanText removes LRM and RLM preheader padding and odd spaces", () => {
  assert.equal(cleanText("Your receipt\n  \u200e\u200f  \u200e\u200f  \u200e\u200f\n\u2800\u2800\nTotal\u00a0R 120"), "Your receipt\n\nTotal R 120");
});

test("cleanText keeps emoji that are built with a joiner", () => {
  assert.equal(cleanText("Family \u{1F468}\u200d\u{1F469}\u200d\u{1F467} trip\u200b"), "Family \u{1F468}\u200d\u{1F469}\u200d\u{1F467} trip");
});

test("cleanText drops converter separator rows and collapses padded columns", () => {
  assert.equal(cleanText("*****************\nTitle\n-----------------\n    Price          99        each"), "Title\n\nPrice 99 each");
});

test("cleanText joins text hard wrapped at a fixed width but keeps lists and short lines", () => {
  const wrapped = [
    "This is a long sentence that a mail program wrapped at a fixed width so it",
    "breaks in odd places when it is shown in a narrow chat bubble on a phone and",
    "keeps going for a while.",
    "",
    "Here is a second paragraph that was also wrapped by the same mail program at",
    "the same width, and it is long enough to show the joining working properly.",
    "* a list item",
    "Thanks,",
    "Sam",
  ].join("\n");
  assert.equal(
    cleanText(wrapped),
    "This is a long sentence that a mail program wrapped at a fixed width so it breaks in odd places when it is shown in a narrow chat bubble on a phone and keeps going for a while.\n\nHere is a second paragraph that was also wrapped by the same mail program at the same width, and it is long enough to show the joining working properly.\n* a list item\nThanks,\nSam",
  );
});

test("weakText spots text parts that are worse than their HTML", () => {
  assert.equal(weakText(""), true);
  assert.equal(weakText("\u200c\u00a0\u200c"), true);
  assert.equal(weakText("Hello  20  table { border-spacing: 0 !important; } p { margin: 0; } Hi"), true);
  assert.equal(weakText("Brand&#x27;s new range: shop now &amp; save &nbsp; more"), true);
  assert.equal(weakText("word ".repeat(300)), true);
  const soup = Array.from({ length: 10 }, (_, i) => `Item ${i} ( https://click.example.com/ls/click?upn=${"a".repeat(60)}${i} )`).join("\n");
  assert.equal(weakText(soup), true);
  assert.equal(weakText("Hi Sam,\n\nSee you at 3. The doc is at https://docs.example.com/d/1.\n\nThanks"), false);
});

test("bodySource keeps a good text part and falls back to HTML for a weak one", () => {
  assert.equal(bodySource("Hi there", "<p>Other</p>"), "Hi there");
  assert.equal(bodySource("p { margin: 0; } a { color: red; } Hello", "<p>Hello from HTML</p>"), "Hello from HTML");
  // HTML made only of images gives nothing better, so the text part stays.
  assert.equal(bodySource("&amp; &amp; &amp; text", '<img src="https://x.example/a.png">'), "&amp; &amp; &amp; text");
});

test("isBulkMail needs an unsubscribe link and a busy layout", () => {
  assert.equal(isBulkMail(NEWSLETTER), true);
  assert.equal(isBulkMail("<p>Hi, lunch on Friday?</p>"), false);
  assert.equal(isBulkMail('<p>Reply to unsubscribe from this list.</p><a href="https://x.example">x</a>'), false);
  assert.equal(isBulkMail(null), false);
});

test("splitFooter moves the unsubscribe footer out of a newsletter body", () => {
  const text = "Big news\nWe opened a new store in town with lots of great things to see and buy.\nCome visit us soon.\nYou are receiving this because you subscribed.\nUnsubscribe (https://x.example/u)\n© 2026 Shop";
  const parts = splitFooter(text);
  assert.equal(parts.body, "Big news\nWe opened a new store in town with lots of great things to see and buy.\nCome visit us soon.");
  assert.match(parts.quoted ?? "", /^You are receiving this/);
  // A word like unsubscribe early on is content, not the footer.
  assert.equal(splitFooter("How to unsubscribe from spam\nA long guide follows here with many words in it.").quoted, undefined);
});

test("bulkPreview leads with the content and leaves addresses, menus and browser links out", () => {
  const body = htmlToText(NEWSLETTER);
  const preview = bulkPreview(splitFooter(body).body);
  assert.equal(preview.more, true);
  assert.doesNotMatch(preview.text, /https?:|View in browser|Women/);
  assert.match(preview.text, /^Spring Sale Starts Now\n\nSave up to 40%/);
  assert.match(preview.text, /Shop Now/);
});

test("bulkPreview clips long text and says nothing is missing from a short one", () => {
  const long = bulkPreview("word ".repeat(200).trim(), 100);
  assert.ok(long.text.length <= 101 && long.text.endsWith("…"));
  assert.equal(long.more, true);
  assert.deepEqual(bulkPreview("Short note\nSecond line"), { text: "Short note\nSecond line", more: false });
});

test("emailParts marks newsletters and splits their footer instead of quoted history", () => {
  const parts = emailParts(null, NEWSLETTER);
  assert.equal(parts.bulk, true);
  assert.match(parts.quoted ?? "", /^You are receiving this email/);
  assert.doesNotMatch(parts.body, /Unsubscribe/);
  assert.equal(emailParts("Thanks\nOn Mon, Sam wrote:\n> hi", "<p>Thanks</p>").bulk, undefined);
});

test("siteOf gives the site a link belongs to", () => {
  assert.equal(siteOf("https://click.e.brand.co.za/x?y=1"), "brand.co.za");
  assert.equal(siteOf("https://www.example.com/a"), "example.com");
  assert.equal(siteOf("https://links.news.example.org/t"), "example.org");
  assert.equal(siteOf("https://t.co/abc"), "t.co");
  assert.equal(siteOf("https://192.168.1.1/a"), "192.168.1.1");
});

test("linkParts shows only the site for a link that follows its own label", () => {
  assert.deepEqual(linkParts("Shop Now (https://click.e.brand.com/ls/click?upn=abc)"), [
    { text: "Shop Now (" },
    { href: "https://click.e.brand.com/ls/click?upn=abc", label: "brand.com" },
    { text: ")" },
  ]);
});

test("weakText treats a text part that only holds the footer or says it is unsupported as weak", () => {
  assert.equal(weakText("------\n\nThis email was intended for Sam Example (Designer)\nLearn why we included this: https://social.example/help\nUnsubscribe: https://social.example/u"), true);
  assert.equal(weakText("text version of this email is not supported\n\nClick on the link below to open the message in a browser:\nhttps://shop.example/"), true);
  assert.equal(weakText("Unsubscribe me from the parents list please, Sam"), true);
  assert.equal(weakText("Hi Sam,\n\nCan you unsubscribe me from the list?\n\nThanks"), false);
});

test("bodySource uses the HTML when the text part has only its footer", () => {
  const html = '<table><tr><td><h1>Alex accepted your invitation</h1></td></tr><tr><td><a href="https://social.example/in/alex?trk=x">Alex Person</a></td></tr></table>';
  const text = "This email was intended for Sam Example\nUnsubscribe: https://social.example/u";
  assert.match(bodySource(text, html), /^Alex accepted your invitation\nAlex Person \(https:\/\/social\.example\/in\/alex\?trk=x\)$/);
});

test("cleanText drops lone picture placeholders and entity names that lost their & and ;", () => {
  assert.equal(cleanText("Thanks,\n\nShop Team\n\nlogo\nlogo\n[image]\n\nExample Ltd, 1zwnj000 Main Road"), "Thanks,\n\nShop Team\n\nExample Ltd, 1000 Main Road");
  assert.equal(cleanText("Our new logo is here"), "Our new logo is here");
  assert.equal(cleanText(`Thanks\n\n${"c1a2".repeat(12)}`), "Thanks");
});

test("emailParts drops a leading View In Browser link but keeps a person asking to open something", () => {
  assert.equal(emailParts("View in your browser (https://mail.example/v/1)\nHi Sam,\nYour profile is nearly done.", "<p>x</p>").body, "Hi Sam,\nYour profile is nearly done.");
  assert.equal(emailParts("View this email online:\nhttps://mail.example/v/2\n\nHello", "<p>x</p>").body, "Hello");
  assert.equal(emailParts("Can you open it in your browser?\nThe file is attached.", "<p>x</p>").body, "Can you open it in your browser?\nThe file is attached.");
  assert.equal(
    emailParts("Hi Matt, the new build is up, open it in your browser: https://staging.example.com/app\nLet me know if the login works.", null).body,
    "Hi Matt, the new build is up, open it in your browser: https://staging.example.com/app\nLet me know if the login works.",
  );
  assert.equal(emailParts("Works in every browser now https://example.com/x\n\nCheers", null).body, "Works in every browser now https://example.com/x\n\nCheers");
});

test("cleanText keeps a hash in the middle of a message and drops one at the very end", () => {
  const sha = "3f2a9c0e1b7d4a6f8e2c5b9d0a1f3e7c6b4d2a8f";
  assert.equal(cleanText(`Deployed this commit:\n${sha}\nPlease verify.`), `Deployed this commit:\n${sha}\nPlease verify.`);
  assert.equal(cleanText(`Thanks\n\n${sha}\n\n`), "Thanks");
});

test("bulkPreview leaves footer lines out of the preview", () => {
  const preview = bulkPreview("Your application was viewed\nThis email was intended for Sam Example (Designer)\nUnsubscribe:\nHelp:");
  assert.equal(preview.text, "Your application was viewed\nHelp:");
  assert.equal(preview.more, true);
});

test("trimSignature keeps the closing and name, and drops the contact details and legal notice under them", () => {
  const text = "Hi\n\nPlease send your transcripts.\n\nRegards\nNorman\n\n1 Silo Square, V&A Waterfront, Cape Town, 8001\nwww.allangray.co.za | info@allangray.co.za\nTo read our Email Legal Notice, browse to this URL:\nhttp://www.allangray.co.za/legal/email_legal.aspx";
  const parts = trimSignature(text);
  assert.equal(parts.body, "Hi\n\nPlease send your transcripts.\n\nRegards\nNorman");
  assert.match(parts.quoted ?? "", /Legal Notice/);
});

test("trimSignature finds a name a blank line below the closing", () => {
  assert.equal(trimSignature("That suits me.\n\nKind regards,\n\nCindy\nCredit Controller\nTel: +27 21 761 0036").body, "That suits me.\n\nKind regards,\n\nCindy");
});

test("trimSignature keeps writing that follows a closing", () => {
  const text = "Thanks!\n\nAlso, could you send the second file as well?";
  assert.equal(trimSignature(text).body, text);
});

test("trimSignature drops a trailing legal run but keeps links above it", () => {
  const parts = trimSignature("Your password changed.\nReview your account:\nhttps://example.com/account\nPrivacy Policy\nhttps://example.com/privacy\n© 2026 Example Inc. All rights reserved.");
  assert.equal(parts.body, "Your password changed.\nReview your account:\nhttps://example.com/account");
});

test("splitQuoted keeps a forwarded email's content", () => {
  const text = "FYI\n\n---------- Forwarded message ---------\nFrom: Sam <s@example.com>\nDate: Mon, 5 Oct 2026\nSubject: Plans\n\nThe plans are attached.";
  assert.equal(splitQuoted(text).body, text);
});

test("splitForward reads a Gmail forward: the note, the header and the forwarded text", () => {
  const parts = splitForward("fyi\n\n---------- Forwarded message ---------\nFrom: Sam Lee <sam@example.com>\nDate: Sat, 10 Oct 2026 at 11:35\nSubject: Plans\nTo: Jo <jo@example.com>\n\nThe plans are attached.\n\nThanks,\nSam\nTel: +27 21 555 0100");
  assert.equal(parts?.body, "fyi");
  assert.deepEqual(parts?.forward, { from: "Sam Lee <sam@example.com>", date: "Sat, 10 Oct 2026 at 11:35", subject: "Plans", to: "Jo <jo@example.com>", body: "The plans are attached.\n\nThanks,\nSam" });
});

test("splitForward reads an Outlook forward only when the subject says Fw", () => {
  const text = "See below.\n\nRegards\nDeon\n\n________________________________\nFrom: Matt <m@example.com>\nSent: Friday, October 23, 2026 11:40\nTo: Deon <d@example.com>\nSubject: Re: Website\n\nHi Deon,\n\nIt is live.";
  const parts = splitForward(text, "Fw: Website");
  assert.equal(parts?.body, "See below.\n\nRegards\nDeon");
  assert.equal(parts?.forward?.date, "Friday, October 23, 2026 11:40");
  assert.equal(parts?.forward?.body, "Hi Deon,\n\nIt is live.");
  assert.equal(splitForward(text, "Re: Website"), null);
});

test("splitForward reads Apple Mail's quoted forward with no banner", () => {
  const parts = splitForward("> From: Matt <m@example.com>\n> Subject: Hello\n> Date: 15 September 2026 at 12:10\n> To: r@example.com\n> \n> Hi Reza,\n> Good to meet you.");
  assert.equal(parts?.body, "");
  assert.equal(parts?.forward?.subject, "Hello");
  assert.equal(parts?.forward?.body, "Hi Reza,\nGood to meet you.");
});

test("trimSignature keeps meeting IDs and account numbers, and cuts a company address", () => {
  const invite = "Join the meeting now\nMeeting ID: 340 449 176 512\nPasscode: ab12cd";
  assert.equal(trimSignature(invite).body, invite);
  assert.equal(trimSignature("Your payment went through.\nPayments profile ID: 0448-7901-1680").body, "Your payment went through.\nPayments profile ID: 0448-7901-1680");
  assert.equal(trimSignature("Your key was created.\n\nAnthropic, PBC\n548 Market St, PMB 90375, San Francisco, CA 94104").body, "Your key was created.");
});

test("cleanText drops Outlook's repeated mailto and tel targets and splits glued links", () => {
  assert.equal(cleanText("andrew@x.com<mailto:andrew@x.com>\nCall +27 21 555 0100 <tel:+27215550100>"), "andrew@x.com\nCall +27 21 555 0100");
  assert.equal(cleanText("Cape Town, 7700https://example.com/x"), "Cape Town, 7700 https://example.com/x");
  assert.equal(cleanText("[Read more](https://example.com/a) today"), "Read more (https://example.com/a) today");
});

test("decodeEntities maps numeric references 128-159 through windows-1252", () => {
  assert.equal(decodeEntities("it&#146;s &#150; &#x80; &#133;"), "it\u2019s \u2013 \u20ac \u2026");
  assert.equal(decodeEntities("a&#129;b"), "ab");
});

test("splitQuoted hides a bottom quote but keeps answers interleaved with quotes", () => {
  const bottom = splitQuoted("Sounds good, Friday works.\n\n> Can we meet Friday?\n> Thanks");
  assert.equal(bottom.body, "Sounds good, Friday works.");
  assert.match(bottom.quoted ?? "", /Can we meet Friday/);
  const inline = "Hi Sam,\n\n> Can we meet Friday?\nYes, Friday works.\n\n> Is 10am fine?\nTen is perfect.\n\nRegards";
  assert.deepEqual(splitQuoted(inline), { body: inline });
  const mixed = splitQuoted("Hi\n\n> a\nanswer one\n\n> b\nanswer two\n\n> old tail\n> more");
  assert.match(mixed.body, /answer two/);
  assert.match(mixed.quoted ?? "", /old tail/);
  assert.doesNotMatch(mixed.body, /old tail/);
});

test("cleanText stays fast on a 1MB hostile string", () => {
  const hostile = ["[https://" + "a".repeat(1000), "<!--" + "x".repeat(1000), "<a href=\"" + "b".repeat(500), "(\u0020".repeat(500) + "https://" + "c".repeat(500), "d".repeat(2000) + " <"];
  for (const unit of hostile) {
    const start = performance.now();
    cleanText(unit.repeat(Math.ceil(1_000_000 / unit.length)));
    assert.ok(performance.now() - start < 500, `slow on ${unit.slice(0, 12)}`);
  }
});
