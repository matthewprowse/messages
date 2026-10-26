// The note editor's content: which formatting a note can hold, and how a file in a note is written in
// markdown. No React and no DOM, so the round trip from markdown and back runs under node:test; the editor
// adds the file's on-screen view in components/note-file-node.tsx.
import { Node, type AnyExtension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { FILE_LINE, fileLine } from "./note-text";

/**
 * A file in a note: a block of its own, written as "![name](attachment:<id>)" for an image or
 * "[name](attachment:<id>)" for anything else. While a file uploads its block has no id yet, only an
 * upload key, and it is left out of the markdown until the upload finishes.
 */
export const NoteFileBase = Node.create({
  name: "noteFile",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: null },
      name: { default: "" },
      image: { default: false },
      upload: { default: null },
    };
  },

  parseHTML() {
    return [{
      tag: "div[data-note-file]",
      getAttrs: (el) => ({ id: el.getAttribute("data-id") || null, name: el.getAttribute("data-name") ?? "", image: el.getAttribute("data-image") === "true" }),
    }];
  },

  renderHTML({ node }) {
    return ["div", { "data-note-file": "", "data-id": node.attrs.id ?? "", "data-name": node.attrs.name, "data-image": String(node.attrs.image) }];
  },

  markdownTokenName: "noteFile",
  markdownTokenizer: {
    name: "noteFile",
    level: "block",
    start: (src: string) => src.search(/^!?\[[^\]\n]*\]\(attachment:/m),
    tokenize: (src: string) => {
      const m = FILE_LINE.exec(src);
      if (!m) return undefined;
      return { type: "noteFile", raw: m[0], image: m[1] === "!", name: m[2], id: m[3] };
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("noteFile", { id: token.id, name: token.name, image: !!token.image }),
  renderMarkdown: (node) => (node.attrs?.id ? fileLine(node.attrs.id, node.attrs.name ?? "", !!node.attrs.image) : ""),
});

/** Everything a note can hold, apart from the file block, which the caller passes in. The editor swaps in
 * a checklist item drawn with the app's own Checkbox. */
export function noteContentExtensions({ taskItem = TaskItem.configure({ nested: true }) }: { taskItem?: AnyExtension } = {}) {
  return [
    StarterKit.configure({
      underline: false,
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" },
    }),
    TaskList,
    taskItem,
    TableKit.configure({ table: { resizable: false } }),
    Image,
  ];
}
