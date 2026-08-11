import type { SupabaseClient } from "@supabase/supabase-js";

const DAY_MS = 86_400_000;

export function futureIso(daysAhead: number, hourUtc = 10): string {
  const d = new Date(Date.now() + daysAhead * DAY_MS);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

export function pastIso(daysBehind: number, hourUtc = 10): string {
  return futureIso(-daysBehind, hourUtc);
}

export async function seedProfile(
  db: SupabaseClient,
  clerkUserId: string,
  displayName: string
): Promise<void> {
  const { error } = await db
    .from("profiles")
    .upsert({ clerk_user_id: clerkUserId, display_name: displayName });
  if (error) throw error;
}

export async function seedChatroom(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from("chatrooms")
    .insert({ name: null })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function seedMember(
  db: SupabaseClient,
  chatroomId: string,
  clerkUserId: string
): Promise<void> {
  const { error } = await db
    .from("chatroom_members")
    .insert({ chatroom_id: chatroomId, clerk_user_id: clerkUserId });
  if (error) throw error;
}

export async function seedSession(
  db: SupabaseClient,
  opts: {
    chatroomId: string;
    proposerId: string;
    status?: "proposed" | "confirmed" | "cancelled" | "completed";
    daysAhead?: number;
    gymId?: string | null;
  }
): Promise<string> {
  const daysAhead = opts.daysAhead ?? 7;

  const { data, error } = await db
    .from("scheduled_sessions")
    .insert({
      chatroom_id: opts.chatroomId,
      proposer_id: opts.proposerId,
      gym_id: opts.gymId ?? null,
      starts_at: futureIso(daysAhead, 10),
      ends_at: futureIso(daysAhead, 11),
      status: opts.status ?? "proposed",
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function cleanup(
  db: SupabaseClient,
  chatroomIds: string[],
  userIds: string[]
): Promise<void> {
  if (chatroomIds.length) {
    await db.from("chatrooms").delete().in("id", chatroomIds);
  }
  if (userIds.length) {
    await db.from("profiles").delete().in("clerk_user_id", userIds);
  }
}

export async function seedConfirmation(
  db: SupabaseClient,
  sessionId: string,
  userId: string,
  status: "going" | "out" = "going"
) {
  const { error } = await db
    .from("session_confirmations")
    .upsert(
      { session_id: sessionId, user_id: userId, status },
      { onConflict: "session_id,user_id" }
    );
  if (error) throw new Error(`seedConfirmation failed: ${error.message}`);
}