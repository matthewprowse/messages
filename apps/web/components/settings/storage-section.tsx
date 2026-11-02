"use client";

// Settings, Storage: what is stored against the plan's allowance.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { openAddresses } from "@/lib/open-rows";
import { STORAGE_CAP_BYTES, bytesLabel, storageLevel } from "@/lib/storage";
import { KIND_LABEL } from "@/components/attachments";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

type Kind = { kind: string; files: number; bytes: number };
type Pool = { seats: number; members: number; bytes: number };
type Big = { id: string; name: string; kind: string; bytes: number; href: string };

const KINDS = ["image", "video", "pdf", "file"];
const files = (n: number) => `${n.toLocaleString()} ${n === 1 ? "File" : "Files"}`;

/** What is stored, against the 20 GB included (a team shares 20 GB for each seat). Pictures, video, PDFs and documents only; voice notes and stickers are not counted. */
export function StorageSection() {
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [biggest, setBiggest] = useState<Big[]>([]);
  const [pool, setPool] = useState<Pool | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Your own files only: a team's work chats assigned to you are not yours to count.
      const me = (await supabase.auth.getSession()).data.session?.user.id ?? "";
      const [usage, big, team] = await Promise.all([
        supabase.from("storage_usage").select("kind, files, bytes").eq("user_id", me),
        supabase
          .from("attachments")
          .select("id, filename, kind, size_bytes, messages!inner(id, thread_id)")
          .eq("user_id", me)
          .not("storage_path", "is", null)
          .neq("kind", "audio")
          .eq("is_sticker", false)
          .order("size_bytes", { ascending: false, nullsFirst: false })
          .limit(10),
        supabase.rpc("my_team_storage"),
      ]);
      if (cancelled) return;
      if (usage.error) return setFailed(true);
      // Someone in a team is measured against the team's total, which everyone on it shares.
      const shared = team.data as unknown as Pool | null;
      setPool(shared ? { seats: Number(shared.seats), members: Number(shared.members), bytes: Number(shared.bytes) } : null);
      setKinds((usage.data ?? []).map((r) => ({ kind: r.kind ?? "file", files: Number(r.files ?? 0), bytes: Number(r.bytes ?? 0) })));
      await openAddresses(big.data ?? []);
      if (cancelled) return;
      setBiggest((big.data ?? []).flatMap((a) => (a.messages ? [{ id: a.id, name: a.filename, kind: a.kind, bytes: Number(a.size_bytes ?? 0), href: `/inbox/${a.messages.thread_id}?message=${a.messages.id}` }] : [])));
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed) return <SettingsSection id="storage" title="Storage" description="Could not load. Check your connection and reopen this page." children={null} />;
  if (!kinds) return <SettingsSection id="storage" title="Storage"><Skeleton className="h-40 w-full rounded-lg" /></SettingsSection>;

  const total = kinds.reduce((n, k) => n + k.bytes, 0);
  const count = kinds.reduce((n, k) => n + k.files, 0);
  const cap = pool ? pool.seats * STORAGE_CAP_BYTES : STORAGE_CAP_BYTES;
  const held = pool ? pool.bytes : total;
  const used = Math.min(100, (held / cap) * 100);
  const level = storageLevel(held, cap);

  return (
    <SettingsSection id="storage" title="Storage" description="Pictures, video, PDFs and documents kept from your conversations. Voice notes and stickers stay in their chats and are not counted.">
      <SettingsRows>
        <div className="space-y-2 p-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{bytesLabel(held)} of {bytesLabel(cap)}{pool && " (shared by your team)"}</span>
            <span className="text-xs text-muted-foreground">{pool ? `Yours: ${bytesLabel(total)}, ${files(count)}` : files(count)}</span>
          </div>
          <Progress value={used} aria-label="Storage used" />
          {level !== "ok" && (
            <p className="text-xs text-muted-foreground">
              {level === "full"
                ? "You have reached your included storage. New files are not saved and show as Not Kept Here; the originals stay in their mailbox or chat. Nothing is deleted, and saving resumes when there is room."
                : "You have used over 80% of your included storage. At 100%, new files stop being saved; the originals stay in their mailbox or chat."}
            </p>
          )}
        </div>
        {KINDS.map((k) => {
          const row = kinds.find((r) => r.kind === k);
          return (
            <SettingsRow key={k} title={`${KIND_LABEL[k as keyof typeof KIND_LABEL]}s`} description={files(row?.files ?? 0)}>
              <span className="text-sm tabular-nums">{bytesLabel(row?.bytes ?? 0)}</span>
            </SettingsRow>
          );
        })}
      </SettingsRows>
      {biggest.length > 0 && (
        <SettingsSection level={3} title="Biggest Files">
          <SettingsRows>
            {biggest.map((b) => (
              <SettingsRow key={b.id} title={<Link href={b.href} className="truncate hover:underline">{b.name}</Link>} description={KIND_LABEL[b.kind as keyof typeof KIND_LABEL]}>
                <span className="text-sm tabular-nums">{bytesLabel(b.bytes)}</span>
              </SettingsRow>
            ))}
          </SettingsRows>
        </SettingsSection>
      )}
    </SettingsSection>
  );
}
