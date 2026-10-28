"use client";

// Your own avatar: the photo you uploaded in Settings, else the picture from the account you signed in with, else a person icon.

import { User } from "lucide-react";
import { useApp } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { useSignedUrl } from "@/lib/signed-urls";
import { PHOTO_BUCKET } from "@/lib/profile-photo";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function MyAvatar({ className, previewUrl }: { className?: string; previewUrl?: string }) {
  const { profile } = useApp();
  const { session } = useAuth();
  const uploaded = useSignedUrl(PHOTO_BUCKET, profile.avatarPath ?? undefined) ?? undefined;
  const meta = (session?.user.user_metadata ?? {}) as { avatar_url?: string; picture?: string };
  const external = meta.avatar_url ?? meta.picture;
  const src = previewUrl ?? uploaded ?? (profile.avatarPath ? undefined : external);
  return (
    <Avatar className={cn("size-8", className)}>
      {src && <AvatarImage src={src} alt="" referrerPolicy="no-referrer" className="object-cover" />}
      <AvatarFallback><User className="size-1/2" /></AvatarFallback>
    </Avatar>
  );
}
