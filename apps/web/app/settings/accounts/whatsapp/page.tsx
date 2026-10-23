"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { Tables } from "@messages/db";
import { encodeQr, qrToSvgPath } from "@messages/qr";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { SettingsHeader } from "@/components/settings-header";
import { SettingsHeading, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/sections";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { openAddresses } from "@/lib/open-rows";

type LinkRow = Pick<Tables<"accounts">, "id" | "status" | "status_detail" | "qr_code" | "pairing_code" | "address">;
const COLUMNS = "id, status, status_detail, qr_code, pairing_code, address";

// The worker does the linking and writes the QR code (or a pairing code) to the account as it changes.
// This page starts a link and shows whichever code is current, live through Realtime.
export default function WhatsAppSetup() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [account, setAccount] = useState<LinkRow | null | undefined>(undefined);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        const row = await openAddresses(p.new as Tables<"accounts">);
        if (row?.provider === "whatsapp") setAccount((prev) => (!prev || prev.id === row.id ? row : prev));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

  const status = account?.status;
  const linking = status === "connecting";
  const linked = status === "connected" || status === "syncing";

  // A safety net while a code is on its way, in case a Realtime update is missed.
  useEffect(() => {
    if (!linking) return;
    const t = setInterval(() => void load(), 4_000);
    return () => clearInterval(t);
  }, [linking, load]);

  const start = async (withPhone: boolean) => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("link_whatsapp", withPhone ? { p_phone: phone } : {});
    setBusy(false);
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  const cancel = async () => {
    if (!account) return;
    await supabase.from("accounts").update({ status: "disconnected" }).eq("id", account.id);
    await load();
  };

  return (
    <>
      <SettingsHeader title="Link WhatsApp" description="Messages joins your WhatsApp as a linked device, the same way WhatsApp Web does." back="/settings/accounts" />

      {account === undefined ? null : linked ? (
        <SettingsRows>
          <SettingsRow
            title={<>WhatsApp <Badge variant="secondary">{status === "syncing" ? "Importing" : "Linked"}</Badge></>}
            description={`${account?.address ? `Linked as ${account.address}. ` : ""}${status === "syncing" ? "Your recent chats are importing from your phone." : "New messages appear in Conversations within seconds."}`}
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
            <Button variant="outline" size="sm" onClick={cancel}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border p-4">
          <SettingsHeading title="Link Your Phone" description="Keep the worker running while you link: pnpm worker" />
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

      <div className="mt-8">
        <SettingsSection id="before-you-link" title="Before You Link">
          <SettingsHeading level={3} title="Your Phone Stays in Charge" description={<>
            <p>
              WhatsApp keeps a linked device only while your phone comes online at least once every 14 days. If it does not, WhatsApp unlinks
              Messages and you scan a new code. Your phone does not need to be on for day-to-day use.
            </p>
          </>} />
          <SettingsHeading level={3} title="The Risk" description={<>
            <p>
              Messages uses WhatsApp Web&apos;s protocol through an unofficial library. WhatsApp does not allow unofficial clients and can ban a
              number that uses one. To keep the risk low, Messages never sends anything on its own, never shows you as online, and only sends what
              you write.
            </p>
          </>} />
          <SettingsHeading level={3} title="Read Receipts" description={<>
            <p>
              Blue ticks are sent only when you open a chat here, and only while WhatsApp Read Receipts is on in{" "}
              <Link href="/settings/notifications" className="underline underline-offset-2">Notifications</Link>.
            </p>
          </>} />
          <SettingsHeading level={3} title="Groups" description={<>
            <p>Group chats are imported, but AI triage is off for them unless you turn it on.</p>
          </>} />
          <SettingsHeading level={3} title="From the Terminal" description={<>
            <p>You can also link from the project folder. The QR code then shows in the terminal:</p>
            <pre className="mt-2 rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">pnpm connect:whatsapp</pre>
          </>} />
          <SettingsHeading level={3} title="Unlinking" description={<>
            <p>
              Remove Messages on your phone under Linked Devices. Disconnect in Connected Accounts only pauses syncing and keeps the link.
            </p>
          </>} />
        </SettingsSection>
      </div>
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
