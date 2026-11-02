"use client";

// The calls behind the Attachments page's file actions: the other rows holding a file (for "Also in N Conversations") and
// deleting files from Konva's storage. Thin; the logic is in copies.ts and the database functions.

import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { groupCopies, type CopyRow, type OtherConversation } from "./copies";

/** The other rows holding the same file. Empty when the function is missing (its migration is not applied) or the call fails. */
export async function loadCopies(attachmentId: string): Promise<CopyRow[]> {
  const { data, error } = await supabase.rpc("attachment_copies", { p_id: attachmentId });
  return error ? [] : data ?? [];
}

/** The other conversations the open file is also in; empty until known, and while `enabled` is false. */
export function useOtherConversations(attachmentId: string, threadId: string | undefined, enabled: boolean): OtherConversation[] {
  const [found, setFound] = useState<{ id: string; list: OtherConversation[] } | null>(null);
  useEffect(() => {
    if (!enabled || !threadId) return;
    let cancelled = false;
    void loadCopies(attachmentId).then((rows) => { if (!cancelled) setFound({ id: attachmentId, list: groupCopies(rows, threadId) }); });
    return () => { cancelled = true; };
  }, [attachmentId, threadId, enabled]);
  return enabled && found?.id === attachmentId ? found.list : [];
}

/**
 * Deletes these files from Konva's storage only (the email or chat is untouched). The database clears each row's copy and
 * queues the stored object for removal once no other row points at it; the worker removes it. Resolves false on failure.
 */
export async function deleteAttachmentFiles(ids: string[]): Promise<boolean> {
  const { error } = await supabase.rpc("delete_attachment_files", { p_ids: ids });
  return !error;
}
