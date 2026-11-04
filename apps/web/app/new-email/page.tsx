"use client";

// Where the installed app's "New Email" shortcut and the phone's share sheet land: the New Email dialog over the inbox,
// prefilled with any shared title (subject), text and link (body). Closing it returns to the inbox. Nothing is sent from here.
// Any site can link here with text filled in too; that is accepted because the share sheet needs the query (manifest.ts
// share_target) and the person still reads, addresses and sends the email themselves.

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ComposeDialog } from "@/components/compose-dialog";

function NewEmail() {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(true);
  const text = params.get("body") ?? "";
  const link = params.get("url") ?? "";
  // Some apps put the link in the text already; do not paste it twice.
  const body = link && !text.includes(link) ? [text, link].filter(Boolean).join("\n\n") : text;
  return (
    <ComposeDialog
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) router.replace("/inbox"); }}
      subject={params.get("subject") ?? ""}
      body={body}
    />
  );
}

export default function NewEmailPage() {
  return <Suspense><NewEmail /></Suspense>;
}
