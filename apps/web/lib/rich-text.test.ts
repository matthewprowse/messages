import { test } from "node:test";
import assert from "node:assert/strict";
import { findEmphasis, richParts, sliceRanges, whatsappMarkup } from "./rich-text";

const marked = (input: string) => {
  const { text, ranges } = whatsappMarkup(input);
  return { text, spans: ranges.map((r) => `${r.mark}:${text.slice(r.start, r.end)}`) };
};

test("whatsappMarkup reads bold, italics, strikethrough and code", () => {
  assert.deepEqual(marked("I'm *free* at _three_, not ~two~. Code `a*b*c`"), {
    text: "I'm free at three, not two. Code a*b*c",
    spans: ["bold:free", "italic:three", "strike:two", "code:a*b*c"],
  });
});

test("whatsappMarkup nests markers and keeps monospace blocks across lines", () => {
  assert.deepEqual(marked("*_Both_* then ```line one\nline *two*```"), {
    text: "Both then line one\nline *two*",
    spans: ["italic:Both", "bold:Both", "code:line one\nline *two*"],
  });
});

test("whatsappMarkup leaves maths, snake case, lists and links as typed", () => {
  for (const s of ["2*3*4 = 24", "use snake_case_names", "* first item\n* second item", "see https://x.com/a_b_c_d and *more*"]) {
    const { text } = whatsappMarkup(s);
    assert.equal(text, s === "see https://x.com/a_b_c_d and *more*" ? "see https://x.com/a_b_c_d and more" : s);
  }
});

test("whatsappMarkup needs text right inside the markers and one line", () => {
  assert.equal(whatsappMarkup("a * b * c").text, "a * b * c");
  assert.equal(whatsappMarkup("*open\nclose*").text, "*open\nclose*");
  assert.equal(whatsappMarkup("**").text, "**");
  assert.equal(whatsappMarkup("*bold*!").text, "bold!");
});

test("whatsappMarkup closes a marker after a link", () => {
  assert.deepEqual(marked("*https://x.com*"), { text: "https://x.com", spans: ["bold:https://x.com"] });
});

test("findEmphasis marks whole words where the HTML had them", () => {
  const text = "Hi Sam,\nThe viewing is on Thursday.\nPlease bring your ID. Thursday works.";
  const ranges = findEmphasis(text, [{ text: "Thursday", mark: "bold" }, { text: "bring your ID", mark: "italic" }]);
  assert.deepEqual(ranges.map((r) => `${r.mark}:${text.slice(r.start, r.end)}@${r.start}`), ["bold:Thursday@26", "italic:bring your ID@43"]);
});

test("findEmphasis skips parts of words and follows repeated runs in order", () => {
  const text = "Start the art class. Art is fun. Art again.";
  const ranges = findEmphasis(text, [{ text: "Art", mark: "bold" }, { text: "Art", mark: "bold" }]);
  assert.deepEqual(ranges.map((r) => r.start), [21, 33]);
});

test("findEmphasis matches across a wrapped line", () => {
  const text = "Your offer on 12 Oak\nStreet was accepted";
  assert.equal(findEmphasis(text, [{ text: "12 Oak Street", mark: "bold" }]).length, 1);
});

test("findEmphasis drops a mark covering most of a long email", () => {
  const text = "word ".repeat(60).trim();
  assert.deepEqual(findEmphasis(text, [{ text, mark: "bold" }]), []);
});

test("richParts splits text by marks and keeps links whole", () => {
  const text = "See the *plan* at https://example.com/a now";
  const { text: plain, ranges } = whatsappMarkup(text);
  assert.deepEqual(richParts(plain, ranges, false), [
    { text: "See the " },
    { text: "plan", marks: ["bold"] },
    { text: " at " },
    { href: "https://example.com/a", label: "example.com/a" },
    { text: " now" },
  ]);
});

test("richParts gives a link the marks that cover all of it", () => {
  const { text, ranges } = whatsappMarkup("_https://example.com_");
  assert.deepEqual(richParts(text, ranges, false), [{ href: "https://example.com", label: "example.com", marks: ["italic"] }]);
});

test("sliceRanges moves and clips ranges into a slice", () => {
  assert.deepEqual(sliceRanges([{ start: 2, end: 8, mark: "bold" }, { start: 20, end: 25, mark: "code" }], 5, 15), [{ start: 0, end: 3, mark: "bold" }]);
});
