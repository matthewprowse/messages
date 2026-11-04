"use client";

// The worker does the linking and writes the QR code (or a pairing code) to the account as it changes.
// This starts a link and shows whichever code is current, live through Realtime. Used in Settings and onboarding.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Tables } from "@messages/db";
import { encodeQr, qrToSvgPath } from "@messages/qr";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { openAddresses } from "@/lib/open-rows";
import { SettingsHeading, SettingsRow, SettingsRows } from "@/components/settings/primitives";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type LinkRow = Pick<Tables<"accounts">, "id" | "status" | "status_detail" | "qr_code" | "pairing_code" | "address">;
const COLUMNS = "id, status, status_detail, qr_code, pairing_code, address";

export function useWhatsAppLink() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [account, setAccount] = useState<LinkRow | null | undefined>(undefined);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // True while the Realtime channel is connected, which makes the polling below a slow safety net.
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("accounts").select(COLUMNS).eq("provider", "whatsapp").order("created_at").limit(1).maybeSingle();
    setAccount(data ? await openAddresses(data) : null);
  }, []);

  useEffect(() => {
    if (!userId) return;
    void load();
    const channel = supabase
      .channel(`whatsapp-link-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "accounts", filter: `user_id=eq.${userId}` }, async (p) => {
        // A deleted row carries no columns, so read the link again rather than guess.
        if (p.eventType === "DELETE") { void load(); return; }
        const changed = p.new as Tables<"accounts">;
        if (changed.provider !== "whatsapp") return;
        // Keep only the columns this page shows, so nothing else on the row is opened or held in state.
        const { id, status, status_detail, qr_code, pairing_code, address } = changed;
        const row = await openAddresses<LinkRow>({ id, status, status_detail, qr_code, pairing_code, address });
        setAccount((prev) => (!prev || prev.id === row.id ? row : prev));
      })
      .subscribe((state) => setLive(state === "SUBSCRIBED"));
    return () => { setLive(false); supabase.removeChannel(channel); };
  }, [userId, load]);

  const status = account?.status;
  const linking = status === "connecting";
  const linked = status === "connected" || status === "syncing";

  // A safety net while a code is on its way, in case a Realtime update is missed.
  useEffect(() => {
    if (!linking) return;
    const t = setInterval(() => void load(), live ? 15_000 : 4_000);
    return () => clearInterval(t);
  }, [linking, live, load]);

  // Runs one change at a time and shows its error, so a failed request never leaves the buttons stuck.
  const run = async (action: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    setError(null);
    try {
      const { error: requestError } = await action();
      if (requestError) setError(requestError.message);
      else await load();
    } finally {
      setBusy(false);
    }
  };

  const start = (withPhone: boolean) => run(() => supabase.rpc("link_whatsapp", withPhone ? { p_phone: phone.trim() } : {}));
  const cancel = () => {
    if (account) void run(() => supabase.from("accounts").update({ status: "disconnected" }).eq("id", account.id));
  };

  return { account, linked, linking, busy, error, phone, setPhone, start, cancel, userId };
}

export type WhatsAppLink = ReturnType<typeof useWhatsAppLink>;

export function WhatsAppLinkPanel({ link }: { link: WhatsAppLink }) {
  const { account, linked, linking, busy, error, phone, setPhone, start, cancel, userId } = link;
  const status = account?.status;
  return (
    <>
      {account === undefined ? <Skeleton className="h-40 w-full rounded-lg" /> : linked ? (
        <SettingsRows>
          <SettingsRow
            title={<>WhatsApp <Badge variant="secondary">{status === "syncing" ? "Importing" : "Linked"}</Badge></>}
            description={`${account?.address ? `Linked as ${account.address}. ` : ""}${status === "syncing" ? "Your recent chats are importing from your phone." : "New messages appear in the Inbox within seconds."}`}
          />
        </SettingsRows>
      ) : linking ? (
        <div className="space-y-4 rounded-lg border p-4">
          <SettingsHeading
            title={account?.pairing_code ? "Enter This Code on Your Phone" : "Scan With Your Phone"}
            description={account?.pairing_code
              ? "In WhatsApp, open Settings, then Linked Devices, then Link a Device, then Link With Phone Number Instead."
              : "In WhatsApp, open Settings, then Linked Devices, then Link a Device, and point your phone at this code."}
          />
          <div className="flex flex-col items-center gap-4">
            {account?.pairing_code ? (
              <div className="font-mono text-3xl font-medium tracking-widest">{account.pairing_code}</div>
            ) : account?.qr_code ? (
              <QrCode value={account.qr_code} />
            ) : (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" />
                <span>{account?.status_detail ?? "Starting."}</span>
              </div>
            )}
            {(account?.qr_code || account?.pairing_code) && <p className="text-xs text-muted-foreground">The code refreshes on its own until it is used.</p>}
            <Button variant="ghost" disabled={busy} onClick={cancel}>Cancel</Button>
            {error && <FieldError>{error}</FieldError>}
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border p-4">
          <SettingsHeading title="Link Your Phone" description="Choose how to link. Your phone stays in charge the whole time." />
          {status === "error" && account?.status_detail && (
            <Alert variant="destructive">
              <AlertTitle>Needs Attention</AlertTitle>
              <AlertDescription>{account.status_detail}</AlertDescription>
            </Alert>
          )}
          <Tabs defaultValue="qr">
            <TabsList>
              <TabsTrigger value="qr">QR Code</TabsTrigger>
              <TabsTrigger value="phone">Phone Number</TabsTrigger>
            </TabsList>
            <TabsContent value="qr" className="pt-3">
              <p className="mb-3 text-sm text-muted-foreground">A QR code appears here to scan with your phone.</p>
              <Button disabled={busy || !userId} onClick={() => start(false)}>Show QR Code</Button>
            </TabsContent>
            <TabsContent value="phone" className="pt-3">
              <Field className="max-w-sm">
                <FieldLabel htmlFor="whatsapp-phone">Phone Number</FieldLabel>
                <Input id="whatsapp-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+44 7700 900123" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <FieldDescription>Your WhatsApp number with its country code. You type the code you get into WhatsApp instead of scanning.</FieldDescription>
              </Field>
              <Button className="mt-3" disabled={busy || !userId || phone.replace(/\D/g, "").length < 7} onClick={() => start(true)}>Get Pairing Code</Button>
            </TabsContent>
          </Tabs>
          {error && <FieldError>{error}</FieldError>}
        </div>
      )}

    </>
  );
}

/** Dark modules on white with a quiet zone, in light and dark themes alike, so phones can always read it. */
function QrCode({ value }: { value: string }) {
  const { path, size } = useMemo(() => {
    const matrix = encodeQr(value);
    return { path: qrToSvgPath(matrix, 4), size: matrix.length + 8 };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="size-64 rounded-lg bg-white" shapeRendering="crispEdges" role="img" aria-label="WhatsApp QR Code">
      <path d={path} fill="#000" />
    </svg>
  );
}
