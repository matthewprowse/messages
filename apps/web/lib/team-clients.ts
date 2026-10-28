"use client";

// The team's shared client list (public.workspace_contacts, 20261101130000_team_contacts.sql), from the app's side.
// Every member reads names, companies and who looks after each client, and never a message: those stay with the chat.

import { useCallback, useEffect, useState } from "react";
import { FIELD } from "@messages/crypto/fields";
import { useAuth } from "./auth";
import { supabase } from "./supabase";
import { open } from "./vault";

export interface TeamClient {
  id: string;
  name: string;
  company: string;
  /** Who looks after them, and whether that person is still in the team. */
  agents: { userId: string; name: string; left: boolean }[];
}

/** The team's clients, names opened with the team's key. null when it failed to load, undefined while loading. */
export function useTeamClients() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [clients, setClients] = useState<TeamClient[] | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.rpc("team_clients");
    if (error) return setClients(null);
    const rows = await Promise.all((data ?? []).map(async (r): Promise<TeamClient> => ({
      id: r.id,
      name: (await open(FIELD.name, r.name)) || "Unknown",
      company: (await open(FIELD.name, r.company_name)) ?? "",
      agents: ((r.agents ?? []) as { user_id: string; name: string; left: boolean }[]).map((a) => ({ userId: a.user_id, name: a.name, left: a.left })),
    })));
    setClients(rows.sort((a, b) => a.name.localeCompare(b.name)));
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  return { clients, reload: () => { setClients(undefined); void load(); } };
}

/** "Sipho and Thandi", or "No one" once every agent has left: the owner has a client to hand to someone. */
export function agentsText(agents: TeamClient["agents"], me: string | undefined): string {
  const names = agents.filter((a) => !a.left).map((a) => (a.userId === me ? "You" : a.name));
  if (!names.length) return agents.length ? "No one now. The agent has left the team." : "No one yet";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
