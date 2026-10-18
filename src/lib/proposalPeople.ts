import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonRef } from "@/types";

/**
 * Who the super admin could give proposal access to: everyone except super
 * admins, who always have it.
 */
export async function fetchProposalGrantees(supabase: SupabaseClient): Promise<PersonRef[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, name, avatar_url, access_level")
    .neq("access_level", "super_admin")
    .order("name");
  return (data || []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    avatarUrl: (p.avatar_url as string | null) ?? null,
  }));
}
