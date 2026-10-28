"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { signOut, useAuth } from "@/lib/auth";
import { INVITE_KEY, ROLE_LABEL, type TeamRole } from "@/lib/team";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type Preview = { workspace: string; role: TeamRole; email: string; strict_sharing: boolean; expires_at: string };

const remember = (token: string | null) => {
  try {
    if (token) localStorage.setItem(INVITE_KEY, token);
    else localStorage.removeItem(INVITE_KEY);
  } catch {
    // Private window or blocked storage: after signing in, open the invite link again.
  }
};

// Someone opens the link they were sent. Signed out, they sign in first (the sign-in page brings them back here).
// Signed in, they read what a team shares and what stays private, and press Join Team to accept.
export default function InvitePage() {
  const router = useRouter();
  const { session } = useAuth();
  const { token } = useParams<{ token: string }>();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("invite_preview", { p_token: token }).then(({ data }) => {
      if (!cancelled) setPreview((data as unknown as Preview | null) ?? null);
    });
    return () => { cancelled = true; };
  }, [token]);

  // Signed in, the sign-in page has done its job: forget the token so a later sign-in does not bring them back here.
  useEffect(() => {
    if (session) remember(null);
  }, [session]);

  const signIn = () => {
    remember(token);
    router.push("/login");
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("accept_invite", { p_token: token });
    setBusy(false);
    if (error) return setError(error.message || "Something went wrong. Try again.");
    remember(null);
    toast("You joined the team");
    router.replace("/settings/team");
  };

  const email = session?.user.email?.toLowerCase();
  const wrongAddress = !!preview && !!email && email !== preview.email;

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-md space-y-6">
        <p className="text-sm font-semibold tracking-tight">Konva</p>

        {preview === undefined || session === undefined ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : preview === null ? (
          <>
            <div>
              <h1 className="flex h-10 items-center text-lg font-medium">Invite Not Valid</h1>
              <p className="text-sm text-muted-foreground">This invite link has been used, has expired or was cancelled. Ask the person who invited you for a new one.</p>
            </div>
            <Button variant="outline" asChild><Link href="/summary">Open Konva</Link></Button>
          </>
        ) : (
          <>
            <div>
              <h1 className="flex h-10 items-center text-lg font-medium">Join {preview.workspace}</h1>
              <p className="text-sm text-muted-foreground">
                You have been invited as {ROLE_LABEL[preview.role]}. The invite is for {preview.email}.
              </p>
            </div>

            <div className="space-y-4 rounded-lg border p-4 text-sm">
              <div>
                <h2 className="font-medium">What the Team Can See</h2>
                <p className="mt-1 text-muted-foreground">Only chats marked as work. Marking a chat as work shares it with {preview.workspace}. You can see everything that is shared in Settings, Team. A colleague you ask to cover for you can read your work chats for the dates you choose, and who covered and when is listed there.</p>
              </div>
              <div>
                <h2 className="font-medium">What Stays Private</h2>
                <p className="mt-1 text-muted-foreground">Everything else: your personal chats, your mail and your notes. The team never sees them, not even a count.</p>
              </div>
              <div>
                <h2 className="font-medium">Compliance</h2>
                <p className="mt-1 text-muted-foreground">
                  {preview.strict_sharing
                    ? `${preview.workspace} has strict sharing on. A work chat stays shared until the owner releases it, and people with the Compliance role can read every work chat in the team. They can never read a personal chat. Compliance can also export a client's work history for the team's records, and you are told when your chats are included.`
                    : `If ${preview.workspace} turns on strict sharing, a work chat stays shared until the owner releases it, and people with the Compliance role can read every work chat in the team. They can never read a personal chat. Compliance can also export a client's work history for the team's records, and you are told when your chats are included.`}
                </p>
              </div>
              <p className="text-muted-foreground">You can leave at any time in Settings, Team. Your own mail and chats stay with you.</p>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            {!session ? (
              <div className="space-y-2">
                <Button className="w-full" onClick={signIn}>Sign In to Join</Button>
                <p className="text-center text-xs text-muted-foreground">Sign in, or create an account, with {preview.email}.</p>
              </div>
            ) : wrongAddress ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">You are signed in as {email}. This invite was sent to {preview.email}.</p>
                <Button variant="outline" className="w-full" onClick={async () => { remember(token); await signOut(); router.push("/login"); }}>Sign In With a Different Account</Button>
              </div>
            ) : (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" disabled={busy} asChild><Link href="/summary">Not Now</Link></Button>
                <Button disabled={busy} onClick={join}>{busy ? "Joining" : "Join Team"}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
