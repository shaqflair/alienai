import type { SupabaseClient } from "@supabase/supabase-js";

export function subscribeToNotifications(
  supabase: SupabaseClient,
  userId: string,
  onEvent: (event: { type: "INSERT" | "UPDATE"; id: string }) => void
) {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `recipient_user_id=eq.${userId}`, // ✅ FIXED
      },
      (payload) => onEvent({ type: "INSERT", id: (payload.new as any).id })
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "notifications",
        filter: `recipient_user_id=eq.${userId}`, // ✅ FIXED
      },
      (payload) => onEvent({ type: "UPDATE", id: (payload.new as any).id })
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
