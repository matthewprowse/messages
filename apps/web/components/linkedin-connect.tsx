"use client";

import { useState } from "react";
import { track } from "@/lib/analytics";
import { postAsUser } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ol>
  );
}

/** Connects LinkedIn with the session cookies from a browser where you are signed in. Saved encrypted; the worker checks them. */
export function LinkedInConnectForm({ onSaved }: { onSaved: () => void }) {
  const [liAt, setLiAt] = useState("");
  const [jsessionid, setJsessionid] = useState("");
  const [curl, setCurl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (body: { liAt: string; jsessionid: string } | { curl: string }) => {
    setBusy(true);
    setError(null);
    try {
      await postAsUser("/api/connect/linkedin", body);
      track("account_connect", { provider: "linkedin", step: "app", outcome: "done" });
      setLiAt("");
      setJsessionid("");
      setCurl("");
      onSaved();
    } catch (err) {
      track("account_connect", { provider: "linkedin", step: "app", outcome: "failed" });
      setError(err instanceof Error ? err.message : "LinkedIn could not be connected. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tabs defaultValue="values">
      <TabsList>
        <TabsTrigger value="values">Cookie Values</TabsTrigger>
        <TabsTrigger value="curl">Copy as cURL</TabsTrigger>
      </TabsList>

      <TabsContent value="values" className="pt-3">
        <Steps items={[
          "On your computer, open a private window in Chrome, Edge or Firefox and sign in at linkedin.com.",
          <>Open the developer tools: Option Command I on a Mac, or F12 on Windows.</>,
          <>In Chrome or Edge, open Application, then Cookies, then https://www.linkedin.com. In Firefox, open Storage, then Cookies.</>,
          <>Copy the value of <span className="font-mono">li_at</span> and of <span className="font-mono">JSESSIONID</span> into the boxes below.</>,
          "Close the private window without signing out, then press Connect LinkedIn.",
        ]} />
        <form onSubmit={(e) => { e.preventDefault(); void save({ liAt, jsessionid }); }}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="linkedin-li-at">li_at</FieldLabel>
              <Input id="linkedin-li-at" type="password" autoComplete="off" spellCheck={false} value={liAt} onChange={(e) => setLiAt(e.target.value)} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="linkedin-jsessionid">JSESSIONID</FieldLabel>
              <Input id="linkedin-jsessionid" type="password" autoComplete="off" spellCheck={false} placeholder="ajax:1234567890" value={jsessionid} onChange={(e) => setJsessionid(e.target.value)} required />
              <FieldDescription>It starts with ajax: and may be shown in quotes. Either way is fine.</FieldDescription>
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <div>
              <Button type="submit" disabled={busy || !liAt.trim() || !jsessionid.trim()}>{busy ? "Saving…" : "Connect LinkedIn"}</Button>
            </div>
          </FieldGroup>
        </form>
      </TabsContent>

      <TabsContent value="curl" className="pt-3">
        <Steps items={[
          "On your computer, open a private window in Chrome, Edge or Firefox and sign in at linkedin.com.",
          "Open the developer tools, then the Network tab, and go to linkedin.com/messaging.",
          <>Right-click a request to www.linkedin.com, then Copy, then Copy as cURL. On Windows, choose Copy as cURL (bash).</>,
          "Paste it below, close the private window without signing out, then press Connect LinkedIn.",
        ]} />
        <form onSubmit={(e) => { e.preventDefault(); void save({ curl }); }}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="linkedin-curl">cURL Command</FieldLabel>
              <Textarea id="linkedin-curl" rows={6} autoComplete="off" spellCheck={false} className="font-mono text-xs" placeholder="curl 'https://www.linkedin.com/…' -H 'cookie: …'" value={curl} onChange={(e) => setCurl(e.target.value)} required />
              <FieldDescription>Only the cookies and LinkedIn&apos;s own headers are kept from it.</FieldDescription>
            </Field>
            {error && <FieldError>{error}</FieldError>}
            <div>
              <Button type="submit" disabled={busy || !curl.trim()}>{busy ? "Saving…" : "Connect LinkedIn"}</Button>
            </div>
          </FieldGroup>
        </form>
      </TabsContent>
    </Tabs>
  );
}
