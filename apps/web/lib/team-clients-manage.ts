"use client";

import { useCallback, useEffect, useState } from "react";
import { encryptTeamField } from "@messages/crypto";
import { FIELD } from "@messages/crypto/fields";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { open, teamKeys } from "./vault";

// What an owner or admin can do to the team's client list (supabase/migrations/20261104100000_team_after_launch.sql): rename a
// client, set or clear their company, change who looks after them, merge two clients, and remove a client or a company from
// the list. Names are sealed with the team's key here. Every function checks who is asking; removing never unshares a chat.

const problem = (error: { message: string } | null) => error?.message || "Something went wrong. Try again.";
const NO_KEY = "Your team's key is not available. Reload the page and try again.";

async function seal(text: string): Promise<string> {
  const team = await teamKeys();
  if (!team) throw new Error("no team key");
  return encryptTeamField(team, FIELD.name, text);
}

export async function renameClient(id: string, name: string): Promise<string | null> {
  try {
    const { error } = await supabase.rpc("rename_team_client", { p_client: id, p_name: await seal(name.trim()) });
    return error ? problem(error) : null;
  } catch {
    return NO_KEY;
  }
}

export interface TeamCompany {
  /** The team blind index of the company's domain: what the sharing rule matches on. */
  domainIndex: string;
  name: string;
}

/** The team's client companies, names opened with the team's key. null when it failed, undefined while loading. */
export function useTeamCompanies(enabled = true) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [companies, setCompanies] = useState<TeamCompany[] | null | undefined>(undefined);
  const load = useCallback(async () => {
    if (!userId || !enabled) return;
    const { data, error } = await supabase.from("workspace_companies").select("domain_index, name");
    if (error) return setCompanies(null);
    const rows = await Promise.all((data ?? []).map(async (r): Promise<TeamCompany> => ({ domainIndex: r.domain_index, name: (await open(FIELD.name, r.name)) || "Company" })));
    setCompanies(rows.sort((a, b) => a.name.localeCompare(b.name)));
  }, [userId, enabled]);
  useEffect(() => { void load(); }, [load]);
  return { companies, reload: load };
}

/**
 * Sets a client's company, or clears it with null. A name that matches a company already on the list (any capitals) joins
 * that company; any other name is only a label on this client and changes no sharing rule.
 */
export async function setClientCompany(id: string, name: string | null, companies: TeamCompany[]): Promise<string | null> {
  try {
    const text = name?.trim() ?? "";
    const known = text ? companies.find((c) => c.name.toLowerCase() === text.toLowerCase()) : undefined;
    const { error } = await supabase.rpc("set_team_client_company", { p_client: id, p_company_name: text ? await seal(known?.name ?? text) : null, p_domain_index: known?.domainIndex ?? null });
    return error ? problem(error) : null;
  } catch {
    return NO_KEY;
  }
}

export async function setClientAgent(id: string, agentId: string): Promise<string | null> {
  const { error } = await supabase.rpc("set_team_client_agent", { p_client: id, p_agent: agentId });
  return error ? problem(error) : null;
}

/** Folds `remove` into `keep`. */
export async function mergeClients(keep: string, remove: string): Promise<string | null> {
  const { error } = await supabase.rpc("merge_team_clients", { p_keep: keep, p_remove: remove });
  return error ? problem(error) : null;
}

export async function removeClient(id: string): Promise<string | null> {
  const { error } = await supabase.rpc("remove_team_client", { p_client: id });
  return error ? problem(error) : null;
}

export async function removeCompany(domainIndex: string): Promise<string | null> {
  const { error } = await supabase.rpc("remove_team_company", { p_domain_index: domainIndex });
  return error ? problem(error) : null;
}
