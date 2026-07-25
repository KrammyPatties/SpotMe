import { supabaseAdmin } from "@/lib/supabase/server";

export type SessionStatus =
  | "proposed"
  | "confirmed"
  | "cancelled"
  | "completed";

export type ChatroomSession = {
  id: string;
  chatroom_id: string;
  proposer_id: string;
  proposer_name: string;
  gym_id: string | null;
  gym_name: string | null;
  starts_at: string;
  ends_at: string;
  status: SessionStatus;
  created_at: string;
};

export type UserGym = { id: string; name: string };

export async function ensureCompletedSessions(
  chatroomId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("scheduled_sessions")
    .update({ status: "completed" })
    .eq("chatroom_id", chatroomId)
    .eq("status", "confirmed")
    .lt("ends_at", new Date().toISOString());

  // Non-fatal: a failed sweep just means the panel shows a stale status.
  if (error) console.error("completed sweep failed:", error);
}

export async function getSessionsForChatroom(
  chatroomId: string
): Promise<ChatroomSession[]> {
  const { data: sessions, error } = await supabaseAdmin
    .from("scheduled_sessions")
    .select(
      "id, chatroom_id, proposer_id, gym_id, starts_at, ends_at, status, created_at"
    )
    .eq("chatroom_id", chatroomId)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true });

  if (error) {
    console.error("session fetch failed:", error);
    return [];
  }
  if (!sessions?.length) return [];

  const proposerIds = [...new Set(sessions.map((s) => s.proposer_id))];
  const gymIds = [
    ...new Set(sessions.map((s) => s.gym_id).filter(Boolean)),
  ] as string[];

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, display_name")
    .in("clerk_user_id", proposerIds);

  const { data: gyms } = gymIds.length
    ? await supabaseAdmin.from("gyms").select("id, name").in("id", gymIds)
    : { data: [] as { id: string; name: string }[] };

  const nameById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.display_name])
  );
  const gymById = new Map((gyms ?? []).map((g) => [g.id, g.name]));

  return sessions.map((s) => ({
    ...s,
    status: s.status as SessionStatus,
    proposer_name: nameById.get(s.proposer_id) ?? "Unknown",
    gym_name: s.gym_id ? gymById.get(s.gym_id) ?? null : null,
  }));
}

export async function getUserGyms(userId: string): Promise<UserGym[]> {
  const { data: links, error } = await supabaseAdmin
    .from("user_gyms")
    .select("gym_id")
    .eq("clerk_user_id", userId);

  if (error || !links?.length) return [];

  const gymIds = links.map((l) => l.gym_id);

  const { data: gyms } = await supabaseAdmin
    .from("gyms")
    .select("id, name")
    .in("id", gymIds)
    .order("name", { ascending: true });

  return (gyms ?? []) as UserGym[];
}