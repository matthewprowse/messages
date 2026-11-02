"use client";

// The /onboarding page: one dialog that can't be closed, stepping from joining to ready. Every step runs on
// mock data and saves nothing; docs/PLAN.md ("Onboarding Flow") says what each step becomes when it is real.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, ImagePlus, Mail, RefreshCw } from "lucide-react";
import { ROLES, type Role } from "@/lib/onboarding-demo";
import { BrandLogo, type Brand } from "@/components/provider-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SettingsRow, SettingsRows } from "@/components/settings/sections";

const STEPS = ["join", "connect", "about", "found", "brief", "ready"] as const;
type Step = (typeof STEPS)[number];

type Service = "google" | "whatsapp" | "icloud" | "microsoft";
const SERVICES: { id: Service; label: string; description: string; brand: Brand }[] = [
  { id: "google", label: "Google", description: "Gmail and Google Calendar, with one sign-in.", brand: "google" },
  { id: "whatsapp", label: "WhatsApp", description: "Scan a code with your phone, like WhatsApp Web.", brand: "whatsapp" },
  { id: "icloud", label: "iCloud", description: "iCloud Mail and Calendar, with an app-specific password.", brand: "icloud" },
  { id: "microsoft", label: "Microsoft", description: "Outlook and Outlook Calendar, work or personal.", brand: "microsoft" },
];

// The totals are known within seconds; only reading and drafting from them takes long.
const COUNT_MS = 2_500;
const TOTALS = { emails: 10_000, whatsapp: 3_117, conversations: 486, contacts: 312 };
/** Mock pace of the full processing, per minute. */
const PER_MINUTE = 450;
const minutesFor = (n: number) => Math.max(1, Math.round(n / PER_MINUTE));

interface State {
  name: string;
  email: string;
  passkey: boolean;
  role: Role | "";
  extra: string;
  photo: string | null;
  connected: Service[];
  briefTime: string;
  briefSpoken: boolean;
  notifyUrgent: boolean;
  notifyDigest: boolean;
}

export function OnboardingFlow() {
  const [step, setStep] = useState<Step>("join");
  const [s, setS] = useState<State>({
    name: "", email: "", passkey: false, role: "", extra: "", photo: null, connected: [],
    briefTime: "07:30", briefSpoken: true, notifyUrgent: true, notifyDigest: false,
  });
  const patch = (p: Partial<State>) => setS((cur) => ({ ...cur, ...p }));
  // The chosen photo is a blob URL: free it when the flow ends (replacing it is handled where it is picked).
  const photoRef = useRef<string | null>(null);
  photoRef.current = s.photo;
  useEffect(() => () => { if (photoRef.current) URL.revokeObjectURL(photoRef.current); }, []);
  const at = STEPS.indexOf(step);
  const next = () => setStep(STEPS[at + 1]);
  const back = at > 0 ? () => setStep(STEPS[at - 1]) : undefined;
  const firstName = s.name.trim().split(/\s+/)[0] ?? "";

  // The pretend first import, from the first connected account.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const hasAccount = s.connected.length > 0;
  useEffect(() => { if (hasAccount && startedAt === null) setStartedAt(Date.now()); }, [hasAccount, startedAt]);
  const progress = startedAt === null ? 0 : Math.min(1, (now - startedAt) / COUNT_MS);
  useEffect(() => {
    if (startedAt === null || progress >= 1) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [startedAt, progress]);

  const frame = { step, at, back, next, s, patch, firstName, progress, hasAccount };
  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        track="onboarding"
        className="flex h-[min(42rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        {step === "join" && <Join {...frame} />}
        {step === "connect" && <Connect {...frame} />}
        {step === "about" && <About {...frame} />}
        {step === "found" && <Found {...frame} />}
        {step === "brief" && <Brief {...frame} />}
        {step === "ready" && <Ready {...frame} />}
      </DialogContent>
    </Dialog>
  );
}

type FrameProps = { step: Step; at: number; back?: () => void; next: () => void; s: State; patch: (p: Partial<State>) => void; firstName: string; progress: number; hasAccount: boolean };

function Frame({ f, title, description, children, footer }: { f: FrameProps; title: string; description?: string; children: React.ReactNode; footer: React.ReactNode }) {
  const n = f.at + 1;
  const processing = f.hasAccount && f.step !== "connect";
  return (
    <>
      <div className="shrink-0 space-y-4 px-6 pt-6">
        <div className="flex items-center gap-3">
          <Progress value={(n / STEPS.length) * 100} className="h-1 flex-1" aria-label={`Step ${n} of ${STEPS.length}`} />
          {processing && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" role="status">
              <RefreshCw className="size-3 animate-spin" /> Processing
            </span>
          )}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{n} of {STEPS.length}</span>
        </div>
        <div className="space-y-1">
          <DialogTitle className="text-lg font-medium">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pb-6">
        {f.back && <Button variant="ghost" onClick={f.back}>Back</Button>}
        <div className="ml-auto flex items-center gap-2">{footer}</div>
      </div>
    </>
  );
}

function Nav({ f, label = "Continue", disabled }: { f: FrameProps; label?: string; disabled?: boolean }) {
  return (
    <Button disabled={disabled} onClick={f.next}>{label}</Button>
  );
}

// 1. Join ---------------------------------------------------------------------------------------------------

function Join(f: FrameProps) {
  const { s, patch } = f;
  const valid = s.name.trim() && /\S+@\S+\.\S+/.test(s.email);
  // Mock: each provider fills a sample person. Real sign-in with Google, Microsoft and Apple comes later.
  const sample = (name: string, email: string) => () => patch({ name: s.name || name, email: s.email || email });
  return (
    <Frame f={f} title="Welcome To Konva" footer={<Nav f={f} disabled={!valid} />}>
      <FieldGroup>
        <div className="space-y-2">
          <Button variant="secondary" className="w-full" onClick={sample("Alex Morgan", "alex@morgan.co.za")}><BrandLogo brand="google" /> Continue With Google</Button>
          <Button variant="secondary" className="w-full" onClick={sample("Alex Morgan", "alex@morgan.co.za")}><BrandLogo brand="microsoft" /> Continue With Microsoft</Button>
          <Button variant="secondary" className="w-full" onClick={sample("Alex Morgan", "alex@icloud.com")}><BrandLogo brand="apple" /> Continue With Apple</Button>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" /></div>
        <Field>
          <FieldLabel htmlFor="ob-name">Your Name</FieldLabel>
          <Input id="ob-name" autoComplete="name" value={s.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="ob-email">Email Address</FieldLabel>
          <Input id="ob-email" type="email" autoComplete="email" value={s.email} onChange={(e) => patch({ email: e.target.value })} />
          <FieldDescription>No password. Konva emails you a code to confirm it's you.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <div className="flex-1">
            <FieldLabel htmlFor="ob-passkey">Set Up a Passkey</FieldLabel>
            <FieldDescription>Sign in with Face ID, Touch ID or your device PIN instead, with no code emailed each time.</FieldDescription>
          </div>
          <Switch id="ob-passkey" checked={s.passkey} onCheckedChange={(v) => patch({ passkey: v })} />
        </Field>
      </FieldGroup>
    </Frame>
  );
}

// 2. Connect ------------------------------------------------------------------------------------------------

function Connect(f: FrameProps) {
  const { s, patch } = f;
  const [busy, setBusy] = useState<Service | null>(null);
  const [qr, setQr] = useState(false);

  const connect = (id: Service) => {
    setBusy(id);
    setTimeout(() => {
      patch({ connected: [...new Set([...s.connected, id])] });
      setBusy(null);
      setQr(false);
    }, 1200);
  };
  return (
    <Frame f={f} title="Connect Where Your Clients Reach You" description="Konva brings in your last 30 days and keeps everything in sync. Nothing is ever sent without you."
      footer={
        <>
          {!f.hasAccount && <Button variant="ghost" onClick={f.next}>Skip, Do Later</Button>}
          <Button disabled={!f.hasAccount} onClick={f.next}>Continue</Button>
        </>
      }>
      <div className="space-y-4">
        <SettingsRows>
          {SERVICES.map((svc) => {
            const live = s.connected.includes(svc.id);
            return (
              <div key={svc.id}>
                <SettingsRow
                  leading={<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><BrandLogo brand={svc.brand} className="size-5" /></div>}
                  title={<>{svc.label} {svc.id === "google" && !live && <Badge variant="outline">Suggested</Badge>} {live && <Badge variant="secondary">Connected</Badge>}</>}
                  description={svc.description}
                >
                  {!live && (
                    <Button disabled={busy === svc.id} onClick={() => (svc.id === "whatsapp" ? setQr(!qr) : connect(svc.id))}>
                      {busy === svc.id ? "Connecting" : svc.id === "whatsapp" && qr ? "Close" : "Connect"}
                    </Button>
                  )}
                </SettingsRow>
                {svc.id === "whatsapp" && qr && !live && (
                  <div className="flex items-center gap-4 border-t px-3 py-4">
                    <div className="grid size-28 shrink-0 grid-cols-7 gap-0.5 rounded-md border bg-background p-2" aria-hidden>
                      {Array.from({ length: 49 }, (_, i) => <span key={i} className={(i * 7 + (i % 5)) % 3 === 0 ? "bg-foreground" : "bg-transparent"} />)}
                    </div>
                    <div className="space-y-2 text-sm">
                      <p>Open WhatsApp on your phone, then Settings, Linked Devices, Link a Device, and scan this code.</p>
                      <Button variant="secondary" disabled={busy === "whatsapp"} onClick={() => connect("whatsapp")}>Pretend I Scanned It</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </SettingsRows>
        <p className="text-xs text-muted-foreground">Mail on your own domain and more can be added later in Settings.</p>
      </div>
    </Frame>
  );
}

// 3. About you ----------------------------------------------------------------------------------------------

function About(f: FrameProps) {
  const { s, patch } = f;
  const initials = s.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (s.photo) URL.revokeObjectURL(s.photo);
    patch({ photo: URL.createObjectURL(file) });
  };
  return (
    <Frame f={f} title="Tell Konva About You" description="While your messages come in, a little about you helps Konva sort what matters and write like you." footer={<Nav f={f} />}>
      <FieldGroup>
        <div className="flex items-center gap-4">
          <Avatar className="size-16">
            {s.photo && <AvatarImage src={s.photo} alt="" />}
            <AvatarFallback className="text-lg">{initials || "?"}</AvatarFallback>
          </Avatar>
          <Button type="button" variant="secondary" asChild>
            <label className="cursor-pointer"><ImagePlus /> {s.photo ? "Change Photo" : "Add a Photo"}<input type="file" accept="image/*" className="hidden" onChange={pick} /></label>
          </Button>
        </div>
        <Field>
          <FieldLabel id="ob-role">What You Do</FieldLabel>
          <ToggleGroup type="single" variant="outline" aria-labelledby="ob-role" value={s.role} onValueChange={(v) => patch({ role: v as Role | "" })} className="flex-wrap justify-start">
            {ROLES.map((r) => <ToggleGroupItem key={r.value} value={r.value}>{r.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor="ob-extra">Anything Else Konva Should Know</FieldLabel>
          <Textarea id="ob-extra" rows={3} value={s.extra} onChange={(e) => patch({ extra: e.target.value })} placeholder="The areas you work in, your agency, the deals you're focused on this month." />
          <FieldDescription>Optional. Konva adds this to what it learns from your messages.</FieldDescription>
        </Field>
      </FieldGroup>
    </Frame>
  );
}

// 4. What Konva found ---------------------------------------------------------------------------------------

function Found(f: FrameProps) {
  const { hasAccount, progress } = f;
  const eased = 1 - Math.pow(1 - progress, 2.2);
  const minutes = minutesFor(TOTALS.emails + TOTALS.whatsapp);
  const stats = [
    ["Emails", TOTALS.emails], ["WhatsApp Messages", TOTALS.whatsapp], ["Conversations", TOTALS.conversations], ["Contacts", TOTALS.contacts],
  ] as const;
  return (
    <Frame f={f}
      title={hasAccount ? "Here's What Konva Found" : "Nothing Connected Yet"}
      description={hasAccount ? `This is everything Konva can see. Reading it all takes about ${minutes} minutes. You can start using Konva now: the newest messages are ready first, and we'll tell you when the rest is done.` : "Connect an account in Settings and Konva will show what it finds."}
      footer={<Nav f={f} label={hasAccount ? "Continue" : "Skip, Do Later"} />}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([label, n]) => (
            <div key={label} className="rounded-lg border p-3">
              <div className="text-xl font-medium tabular-nums">{hasAccount ? Math.round(n * eased).toLocaleString() : "0"}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        {hasAccount && (
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3"><CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>Your last 30 days come first, so Summary and Inbox are useful in a few minutes.</span></li>
            <li className="flex gap-3"><CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>Konva then writes what it learned about you, how you write and who matters most. You can review it in Settings.</span></li>
          </ul>
        )}
      </div>
    </Frame>
  );
}

// 5. Daily brief and notifications --------------------------------------------------------------------------

function Brief(f: FrameProps) {
  const { s, patch } = f;
  return (
    <Frame f={f} title="Start Your Day Ahead" description="A short brief of what needs you, and a nudge only when something can't wait." footer={<Nav f={f} />}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ob-time">Daily Brief</FieldLabel>
          <Select value={s.briefTime} onValueChange={(v) => patch({ briefTime: v })}>
            <SelectTrigger id="ob-time" className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["06:30", "07:00", "07:30", "08:00", "08:30"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <FieldDescription>Ready on your Summary page at this time each weekday.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <div className="flex-1"><FieldLabel htmlFor="ob-spoken">Read It To Me</FieldLabel><FieldDescription>A spoken version you can play while you get ready.</FieldDescription></div>
          <Switch id="ob-spoken" checked={s.briefSpoken} onCheckedChange={(v) => patch({ briefSpoken: v })} />
        </Field>
        <Field orientation="horizontal">
          <div className="flex-1"><FieldLabel htmlFor="ob-urgent">Urgent Messages</FieldLabel><FieldDescription>A notification when a client needs you now.</FieldDescription></div>
          <Switch id="ob-urgent" checked={s.notifyUrgent} onCheckedChange={(v) => patch({ notifyUrgent: v })} />
        </Field>
        <Field orientation="horizontal">
          <div className="flex-1"><FieldLabel htmlFor="ob-digest">Midday Digest</FieldLabel><FieldDescription>One summary of what is waiting for a reply.</FieldDescription></div>
          <Switch id="ob-digest" checked={s.notifyDigest} onCheckedChange={(v) => patch({ notifyDigest: v })} />
        </Field>
      </FieldGroup>
    </Frame>
  );
}

// 6. Ready --------------------------------------------------------------------------------------------------

function Ready(f: FrameProps) {
  const { s, firstName } = f;
  const router = useRouter();
  const lines = [
    f.hasAccount ? `${s.connected.length} ${s.connected.length === 1 ? "account is" : "accounts are"} connected and stay in sync.` : "No accounts yet. Connect one in Settings to bring your messages in.",
    f.hasAccount && `Konva is reading the rest of your messages, about ${minutesFor(TOTALS.emails + TOTALS.whatsapp)} minutes, and will tell you when it is done.`,
    "Konva learns how you write from your sent mail and the edits you make, so drafts sound more like you over time.",
    `Your brief is ready at ${s.briefTime} each weekday${s.briefSpoken ? ", and can be read aloud" : ""}.`,
  ].filter(Boolean) as string[];
  return (
    <Frame f={f} title={firstName ? `You're Ready, ${firstName}` : "You're Ready"} description="Here's what's set up. A short tour shows you where everything is."
      footer={
        <>
          <Button variant="secondary" onClick={() => router.push("/summary")}>Start Using Konva</Button>
          <Button onClick={() => router.push("/summary")}>Show Me Around</Button>
        </>
      }>
      <ul className="space-y-3">
        {lines.map((line) => (
          <li key={line} className="flex gap-3 text-sm"><CircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{line}</span></li>
        ))}
      </ul>
      <Mail className="sr-only" aria-hidden />
    </Frame>
  );
}
