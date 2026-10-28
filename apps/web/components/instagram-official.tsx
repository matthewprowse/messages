"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { postAsUser } from "@/lib/onboarding";
import type { Account } from "@/lib/types";
import { SettingsRow, SettingsRows } from "@/components/settings/sections";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";

/** What ?connect_error= from the Instagram callback means, in words. */
function instagramErrorText(code: string): string {
  if (code === "cancelled") return "Instagram sign-in was cancelled. Try again when you are ready.";
  if (code === "not_granted") return "Konva needs both permissions to read and answer your messages. Try again and leave both switched on.";
  if (code === "personal") return "That is a personal account. Switch it to a Business or Creator account in the Instagram app, or go back and choose Personal.";
  if (code === "expired") return "That sign-in took too long or was opened in another browser. Try again.";
  return "Instagram could not be connected. Try again.";
}

/**
 * Connects a Business or Creator account with Instagram's official sign-in: off to instagram.com to sign in and
 * approve, and back here with the outcome in the address. Render inside <Suspense>. `account` is the Instagram
 * account Konva already has, whose status shows live from the store.
 */
export function InstagramOfficial({ account }: { account?: Account }) {
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether this server has Instagram set up. Unknown until asked; a failed question lets the button try for itself.
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    postAsUser<{ ready: boolean }>("/api/connect/instagram/official", { check: true }).then((r) => alive && setReady(r.ready), () => alive && setReady(true));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const failed = params.get("connect_error");
    if (params.get("connected") === "instagram") {
      toast("Instagram is connected.");
      track("account_connect", { provider: "instagram", step: "app", outcome: "done" });
    } else if (failed) {
      setError(instagramErrorText(failed));
      track("account_connect", { provider: "instagram", step: "app", outcome: "failed", code: failed });
    } else return;
    router.replace("/settings/accounts/instagram");
  }, [params, router]);

  const start = async () => {
    setBusy(true);
    setError(null);
    track("account_connect", { provider: "instagram", step: "app", outcome: "start" });
    try {
      const { url } = await postAsUser<{ url: string }>("/api/connect/instagram/official");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Instagram could not be connected. Try again.");
      setBusy(false);
    }
  };

  const status = account?.status;
  if (status === "connected" || status === "syncing") {
    return (
      <SettingsRows>
        <SettingsRow
          title={<>Instagram <Badge variant="secondary">{status === "syncing" ? "Importing" : "Connected"}</Badge></>}
          description={status === "syncing" ? "Your recent Instagram chats are importing." : `${account?.detail ? `@${account.detail}. ` : ""}New messages appear in the Inbox within a minute or two.`}
        />
      </SettingsRows>
    );
  }
  if (status === "connecting") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border p-6 text-sm text-muted-foreground" aria-live="polite">
        <RefreshCw className="size-4 animate-spin" />
        <span>{account?.statusDetail ?? "Connecting to Instagram."}</span>
        <span className="text-xs">This updates by itself.</span>
      </div>
    );
  }

  return (
    <div className="max-w-sm space-y-3">
      {status === "error" && account?.statusDetail && (
        <Alert variant="destructive">
          <AlertTitle>Needs Attention</AlertTitle>
          <AlertDescription>{account.statusDetail}</AlertDescription>
        </Alert>
      )}
      <Button disabled={busy || ready === false} onClick={start}>{busy ? "Opening Instagram…" : "Continue With Instagram"}</Button>
      {ready === false && <p className="text-sm text-muted-foreground">Not available yet.</p>}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
