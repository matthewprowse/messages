"use client";

// Quick capture: make a note from anywhere and open it, optionally linked to a contact or conversation and titled
// with the conversation's subject. useCaptureNote is the function other screens call; NoteCaptureShortcut binds
// Cmd+Shift+N (Ctrl+Shift+N elsewhere) and reads the open conversation or contact from the page it is on.

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { captureNote, type CaptureOptions } from "@/lib/note-links";
import { captureTitle, targetOfPath, threadLabel } from "@/lib/note-link-map";

/** Returns a function that makes a note (with an optional title, text and links) and opens it in its title. */
export function useCaptureNote() {
  const router = useRouter();
  const busy = useRef(false);
  return useCallback(async (opts: CaptureOptions = {}) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const id = await captureNote(opts);
      router.push(`/notes/${id}?new=1`);
    } catch {
      toast.error("Could not create the note.");
    } finally {
      busy.current = false;
    }
  }, [router]);
}

/** A note about this conversation, titled with its subject (or its name when it has none). */
export function useCaptureForThread() {
  const capture = useCaptureNote();
  const { threadById, contactById } = useApp();
  return useCallback((threadId: string) => {
    const t = threadById(threadId);
    const label = t ? threadLabel(t, (id) => contactById(id)?.name) : "Conversation";
    return capture({ title: captureTitle(t, label), links: [{ kind: "thread", id: threadId }] });
  }, [capture, threadById, contactById]);
}

/** Cmd+Shift+N starts a note; on a conversation or contact page it is linked to that one. Mount once, in the app shell. */
export function NoteCaptureShortcut() {
  const capture = useCaptureNote();
  const forThread = useCaptureForThread();
  const pathname = usePathname();
  const latest = useRef({ capture, forThread, pathname });
  latest.current = { capture, forThread, pathname };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Whichever mount sees the key first handles it; a second mount sees it already taken.
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== "n" || e.defaultPrevented) return;
      e.preventDefault();
      const { capture, forThread, pathname } = latest.current;
      const target = targetOfPath(pathname);
      if (target?.kind === "thread") void forThread(target.id);
      else void capture(target ? { links: [target] } : {});
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
