"use client";

// Setup, as a dialog over the app: connect accounts, then say who you are while the first import runs,
// then check what Konva learned, tidy contacts it is unsure of, and try a reply. It opens for someone new
// (no accounts and no setup flag) and for anyone part-way through, and resumes where they left off.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, ImagePlus, Mail, RefreshCw } from "lucide-react";
import { track } from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import { connectGoogle, googleErrorText, postAsUser, saveOnboarding, SETUP_STEPS, useOnboardingMeta, useSignInName, type SetupStep } from "@/lib/onboarding";
import { foundCounts, importSettled, ROLES, type Role } from "@/lib/onboarding-findings";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import type { Account, Provider } from "@/lib/types";
import { BrandLogo, type Brand } from "@/components/provider-logo";
import { ICloudConnectForm } from "@/components/icloud-connect";
import { ICloudSignIn } from "@/components/icloud-signin";
import { ImapConnectForm } from "@/components/imap-connect";
import { useWhatsAppLink, WhatsAppLinkPanel } from "@/components/whatsapp-link";
import { SettingsRow, SettingsRows } from "@/components/settings/primitives";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SetupContext, StepFrame, useSetup, type SetupState } from "./setup-context";
import { LearnedStep } from "./learned-step";
import { ContactsStep } from "./contacts-step";
import { DraftStep } from "./draft-step";

/** Pages it stays out of the way on: signing in and setting up an account in Settings. */
const AWAY = (path: string) => path === "/login" || path.startsWith("/settings/accounts");

export function SetupDialog() {
  const { session } = useAuth();
  const meta = useOnboardingMeta();
  const pathname = usePathname();
  const userId = session?.user.id;

  // Someone with no flag is new only if they have no accounts. Asked once per user, not read from the
  // store, which also reads empty while loading or after a failed load.
  const [noAccountsFor, setNoAccountsFor] = useState<string | null>(null);
  useEffect(() => {
    if (!userId || meta.onboarding) return;
    let cancelled = false;
    void supabase.from("accounts").select("id", { count: "exact", head: true })
      .then(({ count, error }) => { if (!cancelled && !error && count === 0) setNoAccountsFor(userId); });
    return () => { cancelled = true; };
  }, [userId, meta.onboarding]);

  const saved = SETUP_STEPS.find((s) => s === meta.onboarding);
  const open = !!userId && !AWAY(pathname) && (!!saved || (!meta.onboarding && noAccountsFor === userId));
  if (!open) return null;
  return <Setup key={userId} saved={saved ?? "accounts"} fresh={!meta.onboarding} />;
}

function Setup({ saved, fresh }: { saved: SetupStep; fresh: boolean }) {
  const { accounts, profile, dispatch, loading, threads, contacts } = useApp();
  const signInName = useSignInName();
  const router = useRouter();
  const [step, setStep] = useState<SetupStep>(saved);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [extra, setExtra] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  // The chosen photo is a blob URL: free it when the dialog goes away (replacing it is handled where it is picked).
  const photoRef = useRef<string | null>(null);
  photoRef.current = photo;
  useEffect(() => () => { if (photoRef.current) URL.revokeObjectURL(photoRef.current); }, []);

  // Remembered from the first moment, so signing in again, or on another device, comes back to it.
  useEffect(() => {
    if (!fresh) return;
    void saveOnboarding({ onboarding: "accounts" }).catch(() => undefined);
    track("onboarding_step", { step: "accounts", outcome: "start" });
  }, [fresh]);
  useEffect(() => { if (!loading) setName((n) => n || profile.name || signInName); }, [loading, profile.name, signInName]);

  const live = (providers: Provider[]) => accounts.some((a) => providers.includes(a.provider) && a.status !== "disconnected" && a.status !== "error" && !(a.provider === "whatsapp" && a.status === "connecting"));
  const channels = { mail: live(["gmail", "icloud", "outlook", "imap"]), whatsapp: live(["whatsapp"]) };
  const connected = channels.mail || channels.whatsapp || live(["google_calendar", "icloud_calendar", "outlook_calendar"]);
  // Real numbers: what the workers have brought in so far. Done once no mail or WhatsApp account is still syncing.
  const imported = { started: connected, done: connected && !loading && importSettled(accounts), counts: foundCounts(threads, contacts.length) };

  // Nothing to learn from or tidy without an account, so those steps drop out.
  const steps = useMemo<SetupStep[]>(() => SETUP_STEPS.filter((s) => connected || (s !== "learned" && s !== "contacts")), [connected]);
  const at = Math.max(0, steps.indexOf(step));

  const go = async (to: SetupStep | "done", outcome: "done" | "skipped" = "done") => {
    track("onboarding_step", { step, outcome });
    setBusy(true);
    try {
      await saveOnboarding({ onboarding: to, tour: "done" });
      if (to === "done") router.replace("/summary");
      else setStep(to);
    } catch {
      toast("Could not save your progress. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const state: SetupState = {
    step,
    steps,
    next: () => void go(steps[at + 1] ?? "done"),
    back: at > 0 ? () => setStep(steps[at - 1]) : undefined,
    busy,
    name,
    setName,
    firstName: name.trim().split(/\s+/)[0] ?? "",
    role,
    setRole,
    extra,
    setExtra,
    photo,
    setPhoto,
    channels,
    imported,
  };

  // The name is the one thing saved as soon as it is given: drafts sign off with it.
  const saveName = () => {
    const n = name.trim();
    if (n && n !== profile.name) dispatch({ type: "patchProfile", patch: { name: n } });
  };

  return (
    <SetupContext.Provider value={state}>
      <Dialog open>
        <DialogContent
          showCloseButton={false}
          track="onboarding"
          className="flex h-[min(44rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          {step === "accounts" && <AccountsStep />}
          {step === "about" && <AboutStep onLeave={saveName} />}
          {step === "learned" && <LearnedStep />}
          {step === "contacts" && <ContactsStep />}
          {step === "draft" && <DraftStep />}
          {step === "ready" && <ReadyStep finish={() => go("done")} />}
        </DialogContent>
      </Dialog>
    </SetupContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------------------
// 1. Connect
// ---------------------------------------------------------------------------------------------------------

type Service = "google" | "whatsapp" | "icloud" | "microsoft" | "other";

const SERVICES: Record<Service, { label: string; description: string; providers: Provider[]; brand?: Brand }> = {
  google: { label: "Google", description: "Gmail and Google Calendar, with one sign-in.", providers: ["gmail", "google_calendar"], brand: "google" },
  whatsapp: { label: "WhatsApp", description: "Scan a code with your phone, like WhatsApp Web.", providers: ["whatsapp"], brand: "whatsapp" },
  icloud: { label: "iCloud", description: "iCloud Mail, Calendar and Reminders, with one Apple ID sign-in.", providers: ["icloud", "icloud_calendar"], brand: "icloud" },
  microsoft: { label: "Microsoft", description: "Outlook and Outlook Calendar, work or personal.", providers: ["outlook", "outlook_calendar"], brand: "microsoft" },
  other: { label: "Other Email", description: "Mail on your own domain at Afrihost, xneelo or any IMAP host.", providers: ["imap"] },
};

/** The mail service the sign-in email belongs to, when the address alone says so. */
function serviceOf(email: string): Service | null {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (/^(gmail|googlemail)\.com$/.test(domain)) return "google";
  if (/^(icloud|me|mac)\.com$/.test(domain)) return "icloud";
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return "microsoft";
  return null;
}

/** How a service's accounts stand, from the best of them. */
function standing(accounts: Account[]): Account["status"] | null {
  const order: Account["status"][] = ["connected", "syncing", "connecting", "error", "disconnected"];
  return order.find((s) => accounts.some((a) => a.status === s)) ?? null;
}

function StatusBadge({ status }: { status: Account["status"] }) {
  if (status === "connected") return <Badge variant="secondary">Connected</Badge>;
  if (status === "syncing") return <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> Importing</Badge>;
  if (status === "connecting") return <Badge variant="outline" className="gap-1"><RefreshCw className="size-3 animate-spin" /> Connecting</Badge>;
  if (status === "error") return <Badge variant="destructive">Needs Attention</Badge>;
  return null;
}

function AccountsStep() {
  const { session } = useAuth();
  const { accounts } = useApp();
  const { next, busy } = useSetup();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const email = session?.user.email ?? "";
  const [guess, setGuess] = useState<Service | null>(() => serviceOf(email));
  const [open, setOpen] = useState<Service | null>(null);
  const [pasteICloud, setPasteICloud] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const whatsapp = useWhatsAppLink();

  // A domain of its own: its MX records say which service hosts it.
  useEffect(() => {
    if (!email || serviceOf(email)) return;
    let cancelled = false;
    postAsUser<{ provider: Service | null }>("/api/connect/provider").then((r) => { if (!cancelled && r.provider) setGuess(r.provider); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [email]);

  // Back from Google's sign-in.
  const handled = useRef(false);
  useEffect(() => {
    const connected = params.get("connected");
    const failed = params.get("connect_error");
    if ((!connected && !failed) || handled.current) return;
    handled.current = true;
    if (connected === "google") {
      const partial = params.get("partial");
      toast(partial ? `Google is connected, without ${partial === "gmail" ? "Gmail" : "Calendar"}.` : "Google is connected.");
      track("account_connect", { provider: "google", step: "app", outcome: "done" });
    } else if (failed) {
      setError(googleErrorText(failed));
      track("account_connect", { provider: "google", step: "app", outcome: "failed", code: failed });
    }
    router.replace(pathname);
  }, [params, router, pathname]);

  // Your own mail service first, then WhatsApp, where most clients write, then the rest.
  const order = useMemo(() => {
    const first: Service[] = guess ? [guess, "whatsapp"] : ["whatsapp", "google"];
    return [...new Set<Service>([...first, "google", "whatsapp", "icloud", "microsoft", "other"])];
  }, [guess]);

  const statusOf = (service: Service) =>
    service === "whatsapp" && whatsapp.account
      ? (whatsapp.account.status as Account["status"])
      : standing(accounts.filter((a) => SERVICES[service].providers.includes(a.provider)));
  const isLive = (service: Service, status: Account["status"] | null) =>
    !!status && status !== "disconnected" && !(service === "whatsapp" && status === "connecting");
  const anyConnected = order.some((s) => { const st = statusOf(s); return isLive(s, st) && st !== "error"; });

  const startGoogle = async () => {
    setLeaving(true);
    setError(null);
    track("account_connect", { provider: "google", step: "app", outcome: "start" });
    try {
      await connectGoogle("/summary");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google could not be connected. Try again.");
      setLeaving(false);
    }
  };

  return (
    <StepFrame
      title="Connect Where Your Clients Reach You"
      description="Konva brings in your last 30 days and keeps everything in sync from here on. Nothing is ever sent without you."
      footer={
        <>
          {!anyConnected && <Button variant="ghost" disabled={busy} onClick={next}>Do This Later</Button>}
          <Button disabled={busy || !anyConnected} onClick={next}>Continue</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <SettingsRows>
          {order.map((service) => {
            const status = statusOf(service);
            const live = isLive(service, status);
            return (
              <div key={service}>
                <SettingsRow
                  leading={<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">{SERVICES[service].brand ? <BrandLogo brand={SERVICES[service].brand} className="size-5" /> : <Mail className="size-5" />}</div>}
                  title={<>{SERVICES[service].label} {service === guess && !live && <Badge variant="outline">Suggested</Badge>} {live && status && <StatusBadge status={status} />}</>}
                  description={SERVICES[service].description}
                >
                  {live && status !== "error" ? null : service === "google" ? (
                    <Button size="sm" disabled={leaving} onClick={startGoogle}>{status === "error" ? "Reconnect" : "Connect"}</Button>
                  ) : service === "microsoft" ? (
                    <Button variant="secondary" asChild><Link href="/settings/accounts/microsoft">Set Up</Link></Button>
                  ) : (
                    <Button size="sm" variant={open === service ? "secondary" : "default"} onClick={() => setOpen(open === service ? null : service)}>
                      {open === service ? "Close" : status === "error" ? "Reconnect" : "Connect"}
                    </Button>
                  )}
                </SettingsRow>
                {open === service && service === "icloud" && !live && (
                  <div className="border-t px-4 py-4">
                    {pasteICloud ? (
                      <ICloudConnectForm
                        defaultEmail={email}
                        onConnected={({ calendar }) => {
                          setOpen(null);
                          toast(calendar ? "iCloud Mail and Calendar are connected." : "iCloud Mail is connected. Calendar did not accept the same sign-in.");
                        }}
                      />
                    ) : (
                      <ICloudSignIn
                        defaultEmail={email}
                        onConnected={({ message }) => {
                          setOpen(null);
                          toast(message);
                        }}
                        onUsePassword={() => setPasteICloud(true)}
                      />
                    )}
                  </div>
                )}
                {open === service && service === "other" && !live && (
                  <div className="border-t px-4 py-4">
                    <ImapConnectForm
                      defaultEmail={email}
                      onConnected={({ label }) => {
                        setOpen(null);
                        toast(label === "Email" ? "Your email is connected." : `${label} is connected.`);
                      }}
                    />
                  </div>
                )}
                {open === service && service === "whatsapp" && !live && (
                  <div className="border-t px-4 py-4"><WhatsAppLinkPanel link={whatsapp} /></div>
                )}
              </div>
            );
          })}
        </SettingsRows>
        <p className="text-xs text-muted-foreground">You can connect more later in Settings. The more Konva can see, the better it sorts and drafts.</p>
      </div>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------------------------------------
// 2. About you, while the import runs
// ---------------------------------------------------------------------------------------------------------

function AboutStep({ onLeave }: { onLeave: () => void }) {
  const { next, back, busy, name, setName, role, setRole, extra, setExtra, photo, setPhoto } = useSetup();
  const file = useRef<HTMLInputElement>(null);
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (photo) URL.revokeObjectURL(photo);
    setPhoto(URL.createObjectURL(f));
  };

  return (
    <StepFrame
      title="Tell Konva About You"
      description="While your messages come in, a little about you helps Konva sort what matters and write like you."
      footer={
        <>
          {back && <Button variant="ghost" disabled={busy} onClick={() => { onLeave(); back(); }}>Back</Button>}
          <Button disabled={busy || !name.trim()} onClick={() => { onLeave(); next(); }}>Continue</Button>
        </>
      }
    >
      <FieldGroup>
        <div className="flex items-center gap-4">
          <Avatar className="size-16">
            {photo && <AvatarImage src={photo} alt="" />}
            <AvatarFallback className="text-lg">{initials || "?"}</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <input ref={file} type="file" accept="image/*" className="hidden" onChange={pick} />
            <Button type="button" variant="secondary" onClick={() => file.current?.click()}><ImagePlus /> {photo ? "Change Photo" : "Add a Photo"}</Button>
            <p className="text-xs text-muted-foreground">Optional.</p>
          </div>
        </div>
        <Field>
          <FieldLabel htmlFor="setup-name">Your Name</FieldLabel>
          <Input id="setup-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          <FieldDescription>Drafts sign off with your first name.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel id="setup-role">What You Do</FieldLabel>
          <ToggleGroup type="single" variant="outline" aria-labelledby="setup-role" value={role} onValueChange={(v) => setRole(v as Role | "")} className="flex-wrap justify-start">
            {ROLES.map((r) => <ToggleGroupItem key={r.value} value={r.value}>{r.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor="setup-extra">Anything Else Konva Should Know</FieldLabel>
          <Textarea id="setup-extra" rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="The areas you work in, your agency, the deals you're focused on this month." />
          <FieldDescription>Optional. Konva adds this to what it learns from your messages.</FieldDescription>
        </Field>
      </FieldGroup>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------------------------------------
// 6. Ready
// ---------------------------------------------------------------------------------------------------------

function ReadyStep({ finish }: { finish: () => void }) {
  const { back, busy, channels, imported, firstName } = useSetup();
  const done = [
    (channels.mail || channels.whatsapp) && "Your accounts are connected and stay in sync.",
    imported.done && imported.counts.conversations > 0 && `${imported.counts.conversations.toLocaleString()} conversations have come in so far, with what needs you at the top.`,
    "Tell Konva about your work in Settings, under Personalisation. It learns how you write from the replies you send.",
    "Open any conversation to reply with a tap, a few words, or your own text tidied up.",
  ].filter(Boolean) as string[];
  return (
    <StepFrame
      title={firstName ? `You're Ready, ${firstName}` : "You're Ready"}
      description="Here's what's set up."
      footer={
        <>
          {back && <Button variant="ghost" disabled={busy} onClick={back}>Back</Button>}
          <Button disabled={busy} onClick={finish}>Start Using Konva</Button>
        </>
      }
    >
      <ul className="space-y-3">
        {done.map((line) => (
          <li key={line} className="flex gap-3 text-sm">
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </StepFrame>
  );
}
