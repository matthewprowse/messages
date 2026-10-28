"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

// A team is a workspace in the database; "organization" there means a client company. Reading goes through row-level
// security and the member list function, every change through the database functions, which check who is asking
// (supabase/migrations/20261101100000_workspaces.sql).

export type TeamRole = "owner" | "admin" | "compliance" | "member";
export type TeamStatus = "invited" | "active" | "removed";

export const ROLE_LABEL: Record<TeamRole, string> = { owner: "Owner", admin: "Admin", compliance: "Compliance", member: "Member" };
export const ROLE_HELP: Record<TeamRole, string> = {
  owner: "Runs the team and its seats.",
  admin: "Invites and removes people and changes roles.",
  compliance: "Reads every work chat in the team. Only while strict sharing is on.",
  member: "Shares chats marked as work, and keeps everything else private.",
};

export interface Workspace {
  id: string;
  name: string;
  seats: number;
  strictSharing: boolean;
}

export interface TeamPerson {
  /** Null for an invite that has not been used yet. */
  userId: string | null;
  inviteId: string | null;
  email: string;
  name: string | null;
  role: TeamRole;
  status: TeamStatus;
  joinedAt: string | null;
  leftAt: string | null;
  /** When an unused invite stops working. */
  expiresAt: string | null;
}

/** Where the invite page leaves its token while someone signs in, so the sign-in page can send them back to it. */
export const INVITE_KEY = "konva.invite";

/** The page someone opens to join: the invite's token is the secret. */
export const inviteLink = (token: string) => `${window.location.origin}/invite/${token}`;

/** Roles an owner or admin can give. Only the owner makes admins and Compliance, and Compliance only while strict sharing is on. */
export function assignableRoles(myRole: TeamRole | null, strict: boolean): TeamRole[] {
  const roles: TeamRole[] = myRole === "owner" ? ["admin"] : [];
  roles.push("member");
  if (strict && myRole === "owner") roles.push("compliance");
  return roles;
}

export interface TeamState {
  workspace: Workspace | null;
  people: TeamPerson[];
  /** The signed-in person's role, null without a team. */
  role: TeamRole | null;
}

/** The signed-in person's team, loaded once and again after load() is called. */
export function useTeam() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [state, setState] = useState<TeamState | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setFailed(false);
    const { data: ws, error } = await supabase.from("workspaces").select("id, name, seats, strict_sharing").maybeSingle();
    if (error) return setFailed(true);
    if (!ws) return setState({ workspace: null, people: [], role: null });
    const { data, error: listError } = await supabase.rpc("workspace_members_list");
    if (listError) return setFailed(true);
    const people = (data ?? []).map((r): TeamPerson => ({
      userId: r.user_id,
      inviteId: r.invite_id,
      email: r.email ?? "",
      name: r.display_name,
      role: r.role as TeamRole,
      status: r.status as TeamStatus,
      joinedAt: r.joined_at,
      leftAt: r.left_at,
      expiresAt: r.expires_at,
    }));
    const role = people.find((p) => p.userId === userId && p.status === "active")?.role ?? null;
    setState({ workspace: { id: ws.id, name: ws.name, seats: ws.seats, strictSharing: ws.strict_sharing }, people, role });
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  return { state, failed, load };
}
