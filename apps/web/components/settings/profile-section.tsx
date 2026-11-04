"use client";

// Settings, Profile, the Profile card: your name and photo, shown wherever "You" appears. The photo is cut to a square and shrunk in the
// browser before it is saved.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { clearSignedUrls } from "@/lib/signed-urls";
import { PHOTO_BUCKET, photoPathFor, squareJpeg } from "@/lib/profile-photo";
import { MyAvatar } from "@/components/my-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsBody, SettingsRow, SettingsRows, SettingsSection } from "@/components/settings/primitives";

/** The name form and the photo row. */
export function ProfileSection() {
  return (
    <SettingsSection id="profile" title="Profile">
      <SettingsRows>
        <NameRow />
        <PhotoRow />
      </SettingsRows>
    </SettingsSection>
  );
}

// The form copies the saved name when it mounts, so the section remounts it once the profile has loaded from the server
// (not from the device copy, which a save would otherwise write back over a newer name).
function NameRow() {
  const { loading, fromCopy } = useApp();
  return <NameForm key={loading || fromCopy ? "loading" : "loaded"} />;
}

function NameForm() {
  const { profile, dispatch, notify } = useApp();
  const [name, setName] = useState(profile.name);
  const changed = name.trim() !== profile.name;
  return (
    <SettingsBody>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (!changed) return; dispatch({ type: "patchProfile", patch: { name: name.trim() } }); notify("Saved"); }}>
        <div className="grid flex-1 gap-2"><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Thandi Nkosi" /></div>
        <Button variant="secondary" type="submit" disabled={!changed}>Save</Button>
      </form>
    </SettingsBody>
  );
}

function PhotoRow() {
  const { profile, dispatch } = useApp();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string>();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function upload(file: File | undefined) {
    if (!file || !userId) return;
    setBusy(true);
    try {
      const blob = await squareJpeg(file);
      const path = photoPathFor(userId);
      // The path never changes (the database allows only this one), so the old picture is kept from showing again by
      // not letting it be cached and by forgetting links already signed for it.
      const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "0" });
      if (error) throw new Error("Your photo could not be uploaded. Try again.");
      clearSignedUrls();
      dispatch({ type: "patchProfile", patch: { avatarPath: path } });
      setPreview(URL.createObjectURL(blob));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Your photo could not be uploaded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!userId) return;
    setBusy(true);
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([photoPathFor(userId)]);
    setBusy(false);
    if (error) { toast.error("Your photo could not be removed. Try again."); return; }
    clearSignedUrls();
    dispatch({ type: "patchProfile", patch: { avatarPath: null } });
    setPreview(undefined);
  }

  return (
    <SettingsRow title="Your Photo" leading={<MyAvatar className="size-10" previewUrl={preview} />}>
      <Button variant="secondary" disabled={busy} onClick={() => document.getElementById("profile-photo-input")?.click()}>Upload Photo</Button>
      {profile.avatarPath && <Button variant="ghost" disabled={busy} onClick={remove}>Remove</Button>}
      <input
        id="profile-photo-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void upload(f); }}
      />
    </SettingsRow>
  );
}
