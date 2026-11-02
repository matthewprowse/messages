"use client";

// The note editor: formatting appears as you type ("**" for bold, "# " for a heading, "- " for a list,
// "[ ] " for a checklist) and the note is kept as markdown. HTML in pasted or stored text is only ever
// turned into the editor's own formatting, never put on the page as it is.

import { useEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type Editor, type ReactNodeViewProps } from "@tiptap/react";
import { TaskItem } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  MoreHorizontal,
  Paperclip,
  SquareCode,
  Strikethrough,
  Table,
  TextQuote,
  type LucideIcon,
} from "lucide-react";
import { shouldTakePastedFiles } from "@/lib/outbox-files";
import { noteContentExtensions } from "@/lib/note-markdown";
import { cn } from "@/lib/utils";
import { NoteFileNode } from "@/components/note-file-node";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// navigator.platform is deprecated: the client hints platform is used where the browser has it, else the user agent.
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl+";
// Links a note may hold; any other scheme (javascript:, data:) is refused.
const SAFE_LINK = /^(https?|mailto|tel):/i;

/**
 * How far the on-screen keyboard covers the bottom of the page, in pixels, so a bar can sit just above it.
 * Zero when there is no keyboard, or the browser does not report one.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);
  return inset;
}

/** Files dropped or pasted into the note, with where they were dropped (null: at the cursor). */
export type OnFiles = (files: File[], at: number | null, pasted: boolean) => void;

/** A checklist item, ticked with the app's own Checkbox. */
function TaskItemView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const checked = !!node.attrs.checked;
  return (
    <NodeViewWrapper className="flex items-start gap-2">
      <span contentEditable={false} className="flex h-6 shrink-0 items-center select-none">
        <Checkbox checked={checked} disabled={!editor.isEditable} aria-label={checked ? "Mark as Not Done" : "Mark as Done"} onCheckedChange={(v) => updateAttributes({ checked: v === true })} />
      </span>
      <NodeViewContent className={cn("min-w-0 flex-1", checked && "text-muted-foreground line-through")} />
    </NodeViewWrapper>
  );
}

const NoteTaskItem = TaskItem.extend({
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView, { as: "li", attrs: ({ node }) => ({ "data-type": "taskItem", "data-checked": String(!!node.attrs.checked) }) });
  },
}).configure({ nested: true });

export function useNoteEditor({ markdown, onChange, onFiles }: { markdown: string; onChange: (read: () => string) => void; onFiles: OnFiles }) {
  const change = useRef(onChange);
  const files = useRef(onFiles);
  change.current = onChange;
  files.current = onFiles;
  return useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: [
      ...noteContentExtensions({ taskItem: NoteTaskItem }),
      NoteFileNode,
      Placeholder.configure({ placeholder: "Start Writing" }),
      Markdown,
    ],
    content: markdown,
    contentType: "markdown",
    editorProps: {
      attributes: { class: "note-content", "aria-label": "Note", spellcheck: "true" },
      handlePaste: (_view, event) => {
        const list = Array.from(event.clipboardData?.files ?? []);
        if (!shouldTakePastedFiles(Array.from(event.clipboardData?.types ?? []), list.length)) return false;
        files.current(list, null, true);
        return true;
      },
      // Command-click (Control-click elsewhere) opens a link; a plain click places the cursor in it.
      handleClick: (_view, _pos, event) => {
        if (!(event.metaKey || event.ctrlKey) || !(event.target instanceof Element)) return false;
        const href = event.target.closest("a")?.getAttribute("href");
        if (!href || !SAFE_LINK.test(href)) return false;
        window.open(href, "_blank", "noopener,noreferrer");
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const list = Array.from(event.dataTransfer?.files ?? []);
        if (moved || list.length === 0) return false;
        event.preventDefault();
        files.current(list, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null, false);
        return true;
      },
    },
    // The note is turned into markdown only when a save asks for it, not on every keystroke.
    onUpdate: ({ editor }) => change.current(() => editor.getMarkdown()),
  });
}

function ToolButton({ label, shortcut, icon: Icon, active, disabled, onClick }: { label: string; shortcut?: string; icon: LucideIcon; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          // Keeps the cursor and selection in the note.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{shortcut ? `${label} (${shortcut})` : label}</TooltipContent>
    </Tooltip>
  );
}

function Divider() {
  return <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />;
}

export function NoteToolbar({ editor, onAttach, className }: { editor: Editor; onAttach: () => void; className?: string }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      table: e.isActive("table"),
    }),
  });
  const run = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatting" className={cn("no-scrollbar flex items-center gap-0.5 overflow-x-auto", className)}>
      <ToolButton label="Bold" shortcut={`${MOD}B`} icon={Bold} active={s.bold} onClick={() => run().toggleBold().run()} />
      <ToolButton label="Italic" shortcut={`${MOD}I`} icon={Italic} active={s.italic} onClick={() => run().toggleItalic().run()} />
      <ToolButton label="Strikethrough" icon={Strikethrough} active={s.strike} onClick={() => run().toggleStrike().run()} />
      <ToolButton label="Inline Code" icon={Code} active={s.code} onClick={() => run().toggleCode().run()} />
      <Divider />
      <ToolButton label="Heading 1" icon={Heading1} active={s.h1} onClick={() => run().toggleHeading({ level: 1 }).run()} />
      <ToolButton label="Heading 2" icon={Heading2} active={s.h2} onClick={() => run().toggleHeading({ level: 2 }).run()} />
      <ToolButton label="Heading 3" icon={Heading3} active={s.h3} onClick={() => run().toggleHeading({ level: 3 }).run()} />
      <Divider />
      <ToolButton label="Bulleted List" icon={List} active={s.bullet} onClick={() => run().toggleBulletList().run()} />
      <ToolButton label="Numbered List" icon={ListOrdered} active={s.ordered} onClick={() => run().toggleOrderedList().run()} />
      <ToolButton label="Checklist" icon={ListTodo} active={s.task} onClick={() => run().toggleTaskList().run()} />
      <Divider />
      {/* Below a container width these four move into More, so Link and Attach stay in view. */}
      <div className="hidden items-center gap-0.5 @md:flex">
        <ToolButton label="Quote" icon={TextQuote} active={s.quote} onClick={() => run().toggleBlockquote().run()} />
        <ToolButton label="Code Block" icon={SquareCode} active={s.codeBlock} onClick={() => run().toggleCodeBlock().run()} />
        <TableMenu editor={editor} active={s.table} />
        <ToolButton label="Divider" icon={Minus} onClick={() => run().setHorizontalRule().run()} />
      </div>
      <MoreMenu editor={editor} state={s} />
      <Divider />
      <LinkButton editor={editor} active={s.link} />
      <ToolButton label="Attach Files" icon={Paperclip} onClick={onAttach} />
    </div>
  );
}

function TableItems({ editor }: { editor: Editor }) {
  const run = () => editor.chain().focus();
  return (
    <>
      <DropdownMenuItem onClick={() => run().addRowBefore().run()}>Add Row Above</DropdownMenuItem>
      <DropdownMenuItem onClick={() => run().addRowAfter().run()}>Add Row Below</DropdownMenuItem>
      <DropdownMenuItem onClick={() => run().addColumnBefore().run()}>Add Column Left</DropdownMenuItem>
      <DropdownMenuItem onClick={() => run().addColumnAfter().run()}>Add Column Right</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => run().deleteRow().run()}>Delete Row</DropdownMenuItem>
      <DropdownMenuItem onClick={() => run().deleteColumn().run()}>Delete Column</DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={() => run().deleteTable().run()}>Delete Table</DropdownMenuItem>
    </>
  );
}

function TableMenu({ editor, active }: { editor: Editor; active: boolean }) {
  if (!active) return <ToolButton label="Table" icon={Table} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" aria-label="Table" onMouseDown={(e) => e.preventDefault()}><Table /></Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Table</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-max" onCloseAutoFocus={(e) => { e.preventDefault(); editor.commands.focus(); }}>
        <TableItems editor={editor} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Quote, Code Block, Table and Divider on a narrow toolbar. */
function MoreMenu({ editor, state }: { editor: Editor; state: { quote: boolean; codeBlock: boolean; table: boolean } }) {
  const run = () => editor.chain().focus();
  const active = state.quote || state.codeBlock || state.table;
  return (
    <div className="flex items-center @md:hidden">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant={active ? "secondary" : "ghost"} size="icon" aria-label="More" onMouseDown={(e) => e.preventDefault()}><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-max" onCloseAutoFocus={(e) => { e.preventDefault(); editor.commands.focus(); }}>
          <DropdownMenuItem onClick={() => run().toggleBlockquote().run()}><TextQuote />Quote</DropdownMenuItem>
          <DropdownMenuItem onClick={() => run().toggleCodeBlock().run()}><SquareCode />Code Block</DropdownMenuItem>
          <DropdownMenuItem onClick={() => run().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table />Table</DropdownMenuItem>
          <DropdownMenuItem onClick={() => run().setHorizontalRule().run()}><Minus />Divider</DropdownMenuItem>
          {state.table && (
            <>
              <DropdownMenuSeparator />
              <TableItems editor={editor} />
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Adds, changes or removes the link at the cursor. With nothing selected, the address itself becomes the text. */
function LinkButton({ editor, active }: { editor: Editor; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  // Command-K (Control-K) in the note opens the link box.
  useEffect(() => {
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      }
    };
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [editor]);
  useEffect(() => {
    if (open) setHref((editor.getAttributes("link").href as string | undefined) ?? "");
  }, [open, editor]);

  const apply = () => {
    const raw = href.trim();
    setOpen(false);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!raw) { chain.unsetLink().run(); return; }
    // "example.com:8080" has no scheme of its own, so only "name://" or a known scheme counts as one.
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^(javascript|data|vbscript|file|blob):/i.test(raw);
    const url = SAFE_LINK.test(raw) ? raw : hasScheme ? null : `https://${raw}`;
    if (!url) { chain.run(); return; }
    if (editor.state.selection.empty && !active) {
      chain.insertContent({ type: "text", text: raw, marks: [{ type: "link", attrs: { href: url } }] }).run();
    } else {
      chain.setLink({ href: url }).run();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant={active ? "secondary" : "ghost"} size="icon" aria-label="Link" onMouseDown={(e) => e.preventDefault()}><Link2 /></Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Link ({MOD}K)</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80" onCloseAutoFocus={(e) => e.preventDefault()}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); apply(); }}>
          <Input autoFocus type="text" inputMode="url" value={href} onChange={(e) => setHref(e.target.value)} placeholder="Paste or Type a Link" aria-label="Link Address" />
          <div className="flex justify-end gap-2">
            {active && (
              <>
                {SAFE_LINK.test(href.trim()) && (
                  <Button type="button" variant="secondary" asChild>
                    <a href={href.trim()} target="_blank" rel="noopener noreferrer">Open</a>
                  </Button>
                )}
                <Button type="button" variant="secondary" onClick={() => { setHref(""); setOpen(false); editor.chain().focus().extendMarkRange("link").unsetLink().run(); }}>Remove</Button>
              </>
            )}
            <Button type="submit">Save</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
