import { cloudEnabled, supabase } from "@/lib/supabase";

/** Paginowany odczyt remote IDs — używany przez migrację (błąd ⇒ awaiting_remote). */
export async function fetchAllRemoteItemIdsForUser(
  _userId: string,
): Promise<{ ids: string[]; error: string | null }> {
  if (!cloudEnabled || !supabase) {
    return { ids: [], error: "supabase_unavailable" };
  }
  const ids: string[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("items")
      .select("id")
      .range(from, from + pageSize - 1);
    if (error) return { ids: [], error: error.message };
    const rows = data ?? [];
    for (const row of rows) {
      if (row?.id) ids.push(row.id as string);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return { ids, error: null };
}
