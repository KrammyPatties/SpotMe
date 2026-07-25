import { supabaseAdmin } from "@/lib/supabase/server";
import { aggregateRating, pendingRatees } from "@/lib/ratings";
import type { RatingAggregate } from "@/lib/ratings";

export type PendingRating = {
  sessionId: string;
  chatroomId: string;
  startsAt: string;
  endsAt: string;
  gymName: string | null;
  pendingMembers: { clerkUserId: string; displayName: string }[];
};

/**
 * Aggregate ratings for several users at once.
 *
 * Batched because the match feed needs an aggregate per candidate - one query
 * per candidate would be a round trip per card.
 *
 * Users with no ratings are still present in the map, carrying the neutral
 * prior, so callers never have to special-case a missing key.
 */
export async function getRatingAggregates(
  userIds: string[]
): Promise<Map<string, RatingAggregate>> {
  const result = new Map<string, RatingAggregate>();
  if (!userIds.length) return result;

  const { data, error } = await supabaseAdmin
    .from("ratings")
    .select("ratee_id, score")
    .in("ratee_id", userIds);

  if (error) console.error("rating aggregate fetch failed:", error);

  const scoresByUser = new Map<string, number[]>();
  for (const row of data ?? []) {
    const list = scoresByUser.get(row.ratee_id) ?? [];
    list.push(row.score);
    scoresByUser.set(row.ratee_id, list);
  }

  for (const id of userIds) {
    result.set(id, aggregateRating(scoresByUser.get(id) ?? []));
  }

  return result;
}

export async function getRatingAggregate(
  userId: string
): Promise<RatingAggregate> {
  const map = await getRatingAggregates([userId]);
  return map.get(userId) ?? aggregateRating([]);
}

/**
 * Resolve one session into a rating target for this user, or null.
 *
 * Returns null when the session doesn't exist, hasn't completed, the user
 * isn't a member, or they've already rated everyone. The form page treats
 * null as "redirect away", so this is the page's authorisation check as well
 * as its data load.
 */
export async function getRatingTarget(
  sessionId: string,
  userId: string
): Promise<PendingRating | null> {
  const { data: session } = await supabaseAdmin
    .from("scheduled_sessions")
    .select("id, chatroom_id, gym_id, starts_at, ends_at, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.status !== "completed") return null;

  const { data: members } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id")
    .eq("chatroom_id", session.chatroom_id);

  const memberIds = (members ?? []).map((m) => m.clerk_user_id);
  if (!memberIds.includes(userId)) return null;

  const { data: existing } = await supabaseAdmin
    .from("ratings")
    .select("ratee_id")
    .eq("session_id", sessionId)
    .eq("rater_id", userId);

  const pendingIds = pendingRatees(memberIds, userId, existing ?? []);
  if (!pendingIds.length) return null;

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, display_name")
    .in("clerk_user_id", pendingIds);

  const nameById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.display_name])
  );

  let gymName: string | null = null;
  if (session.gym_id) {
    const { data: gym } = await supabaseAdmin
      .from("gyms")
      .select("name")
      .eq("id", session.gym_id)
      .maybeSingle();
    gymName = gym?.name ?? null;
  }

  return {
    sessionId: session.id,
    chatroomId: session.chatroom_id,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    gymName,
    pendingMembers: pendingIds.map((id) => ({
      clerkUserId: id,
      displayName: nameById.get(id) ?? "Unknown",
    })),
  };
}

/**
 * The most recent completed session in this room that the user still owes a
 * rating for, or null.
 *
 * Scans the last 10 completed sessions rather than all of them — anything
 * older is stale enough that prompting for it would be noise. All the data is
 * fetched in three batched queries and the per-session decision happens in JS.
 */
export async function getPendingRating(
  chatroomId: string,
  userId: string
): Promise<PendingRating | null> {
  const { data: sessions } = await supabaseAdmin
    .from("scheduled_sessions")
    .select("id, ends_at")
    .eq("chatroom_id", chatroomId)
    .eq("status", "completed")
    .order("ends_at", { ascending: false })
    .limit(10);

  if (!sessions?.length) return null;

  const sessionIds = sessions.map((s) => s.id);

  const [{ data: members }, { data: existing }] = await Promise.all([
    supabaseAdmin
      .from("chatroom_members")
      .select("clerk_user_id")
      .eq("chatroom_id", chatroomId),
    supabaseAdmin
      .from("ratings")
      .select("session_id, ratee_id")
      .eq("rater_id", userId)
      .in("session_id", sessionIds),
  ]);

  const memberIds = (members ?? []).map((m) => m.clerk_user_id);
  if (!memberIds.includes(userId)) return null;

  const ratedBySession = new Map<string, { ratee_id: string }[]>();
  for (const row of existing ?? []) {
    const list = ratedBySession.get(row.session_id) ?? [];
    list.push({ ratee_id: row.ratee_id });
    ratedBySession.set(row.session_id, list);
  }

  // Newest first — prompt for the most recent unrated session.
  const target = sessions.find(
    (s) =>
      pendingRatees(memberIds, userId, ratedBySession.get(s.id) ?? []).length > 0
  );

  return target ? getRatingTarget(target.id, userId) : null;
}

/**
 * Every session in this room the user still owes a rating for.
 *
 * getPendingRating returns one session for the chatroom prompt; the log needs
 * the whole set to split its tabs. Both run through pendingRatees, so the tab
 * split can't drift from the prompt.
 */
export async function getPendingRatingSessionIds(
  chatroomId: string,
  userId: string,
): Promise<string[]> {
  const { data: sessions } = await supabaseAdmin
    .from("scheduled_sessions")
    .select("id")
    .eq("chatroom_id", chatroomId)
    .eq("status", "completed");

  if (!sessions?.length) return [];

  const sessionIds = sessions.map((s) => s.id);

  const [{ data: members }, { data: existing }] = await Promise.all([
    supabaseAdmin
      .from("chatroom_members")
      .select("clerk_user_id")
      .eq("chatroom_id", chatroomId),
    supabaseAdmin
      .from("ratings")
      .select("session_id, ratee_id")
      .eq("rater_id", userId)
      .in("session_id", sessionIds),
  ]);

  const memberIds = (members ?? []).map((m) => m.clerk_user_id);
  if (!memberIds.includes(userId)) return [];

  const ratedBySession = new Map<string, { ratee_id: string }[]>();
  for (const row of existing ?? []) {
    const list = ratedBySession.get(row.session_id) ?? [];
    list.push({ ratee_id: row.ratee_id });
    ratedBySession.set(row.session_id, list);
  }

  return sessionIds.filter(
    (id) =>
      pendingRatees(memberIds, userId, ratedBySession.get(id) ?? []).length > 0,
  );
}