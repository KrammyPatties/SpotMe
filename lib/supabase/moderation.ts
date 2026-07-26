import { supabaseAdmin } from "@/lib/supabase/server";
import { aggregateRating } from "@/lib/ratings";
import {
  computeRatingFlag,
  currentModerationStatus,
  type ModerationActionRecord,
  type ModerationActionType,
  type ModerationResult,
  type ModerationStatus,
  type RatingFlag,
} from "@/lib/moderation";

export type FlaggedUser = {
  clerkUserId: string;
  displayName: string;
  mean: number | null;
  count: number;
  adjusted: number;
  flag: RatingFlag;
  status: ModerationStatus;
};

export type QueueReport = {
  id: string;
  reason: string;
  createdAt: string;
  reporterId: string;
  reporterName: string;
  reportedId: string;
  reportedName: string;
  reportedFlag: RatingFlag;
  reportedStatus: ModerationStatus;
  /** Lifetime reports against this user, resolved or not - repeat-offender signal. */
  reportsAgainstCount: number;
};

export type ActionLogEntry = {
  id: string;
  action: ModerationActionType;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  targetName: string;
  adminName: string;
  reportId: string | null;
};

export type ReviewEntry = {
  score: number;
  review: string;
  createdAt: string;
};

export type DashboardStats = {
  totalUsers: number;
  openReports: number;
  flaggedUsers: number;
  activeSuspensions: number;
};

/**
 * Every user's derived moderation status, in one query.
 *
 * The whole action log is fetched and grouped in JS rather than asking Postgres
 * for "the latest action per user". A latest-per-user query is a window
 * function or a lateral join, and the status rule (expiry, lift-overrides-
 * suspension) already lives in currentModerationStatus as a tested pure
 * function - reimplementing it in SQL would be a second source of truth for
 * the same rule. The table is append-only and small.
 *
 * Users absent from the log are absent from the map; callers default to
 * "active".
 */
async function statusesByUser(): Promise<Map<string, ModerationStatus>> {
  const result = new Map<string, ModerationStatus>();

  const { data, error } = await supabaseAdmin
    .from("moderation_actions")
    .select("target_user_id, action, expires_at, created_at");

  if (error) {
    console.error("moderation action fetch failed:", error);
    return result;
  }

  const byUser = new Map<string, ModerationActionRecord[]>();
  for (const row of data ?? []) {
    const list = byUser.get(row.target_user_id) ?? [];
    list.push({
      action: row.action,
      expires_at: row.expires_at,
      created_at: row.created_at,
    });
    byUser.set(row.target_user_id, list);
  }

  const now = new Date();
  for (const [userId, actions] of byUser) {
    result.set(userId, currentModerationStatus(actions, now));
  }

  return result;
}

/**
 * One user's enforcement status, for the request-path guard.
 *
 * This deliberately FAILS OPEN, inverting the project's fail-closed rule, and
 * the inversion is the point. Fail-closed on an authorisation check denies one
 * person access to one resource. Fail-closed here would treat every user as
 * suspended on any database hiccup - a self-inflicted outage of the whole app.
 * The cost of failing open is that a suspended user gets one more request
 * through until the database recovers. Document this asymmetry; it is a
 * decision, not an oversight.
 */
export async function getModerationStatus(
  userId: string
): Promise<ModerationStatus> {
  const { data, error } = await supabaseAdmin
    .from("moderation_actions")
    .select("action, expires_at, created_at")
    .eq("target_user_id", userId);

  if (error) {
    console.error("moderation status fetch failed:", error);
    return "active";
  }

  return currentModerationStatus(data ?? []);
}

/**
 * Users whose shrunk rating average falls below the watch threshold.
 *
 * Returns a discriminated result rather than an array, because a silent empty
 * list is the wrong failure mode here. getRatingAggregates (used by the match
 * feed) logs its error and continues, which scores everyone as unrated - a
 * graceful degradation for ranking, but for a moderation queue it would render
 * a reassuring empty table when the truth is "we cannot see the data". The
 * page needs to be able to say so.
 *
 * Unrated users are never flaggable (adjusted equals the prior), so the
 * candidate set is exactly the users who appear in `ratings`. The whole column
 * pair is fetched and grouped in JS, reusing aggregateRating so there is only
 * ever one implementation of the shrinkage arithmetic.
 */
export async function getFlaggedUsers(): Promise<ModerationResult<FlaggedUser[]>> {
  const { data: ratings, error } = await supabaseAdmin
    .from("ratings")
    .select("ratee_id, score");

  if (error) {
    console.error("flagged user fetch failed:", error);
    return { ok: false, error: "Rating data is unavailable" };
  }

  const scoresByUser = new Map<string, number[]>();
  for (const row of ratings ?? []) {
    const list = scoresByUser.get(row.ratee_id) ?? [];
    list.push(row.score);
    scoresByUser.set(row.ratee_id, list);
  }

  const flagged: Omit<FlaggedUser, "displayName" | "status">[] = [];
  for (const [userId, scores] of scoresByUser) {
    const aggregate = aggregateRating(scores);
    const flag = computeRatingFlag(aggregate);
    if (flag !== "watch" && flag !== "severe") continue;
    flagged.push({
      clerkUserId: userId,
      mean: aggregate.mean,
      count: aggregate.count,
      adjusted: aggregate.adjusted,
      flag,
    });
  }

  if (!flagged.length) return { ok: true, value: [] };

  const ids = flagged.map((f) => f.clerkUserId);

  const [{ data: profiles }, statuses] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("clerk_user_id, display_name")
      .in("clerk_user_id", ids),
    statusesByUser(),
  ]);

  const nameById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.display_name])
  );

  const value = flagged.map((f) => ({
    ...f,
    displayName: nameById.get(f.clerkUserId) ?? "Unknown",
    status: statuses.get(f.clerkUserId) ?? ("active" as ModerationStatus),
  }));

  // Severe first, then by how bad the shrunk average is. The admin should not
  // have to scan for the worst case.
  value.sort((a, b) => {
    if (a.flag !== b.flag) return a.flag === "severe" ? -1 : 1;
    return a.adjusted - b.adjusted;
  });

  return { ok: true, value };
}

/**
 * Open reports, newest first, with the context needed to act without a
 * drill-down: who reported whom, why, the target's rating flag and current
 * status, and how many times they have been reported before.
 *
 * Batched: reports -> profiles -> ratings -> statuses. No attempt at
 * reports -> profiles -> ratings as a nested join; that is the two-hop shape
 * Supabase has failed to resolve three times in this project.
 */
export async function getModerationQueue(): Promise<ModerationResult<QueueReport[]>> {
  const { data: reports, error } = await supabaseAdmin
    .from("reports")
    .select("id, reporter_id, reported_id, reason, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("report queue fetch failed:", error);
    return { ok: false, error: "Reports are unavailable" };
  }

  if (!reports?.length) return { ok: true, value: [] };

  const userIds = Array.from(
    new Set(reports.flatMap((r) => [r.reporter_id, r.reported_id]))
  );
  const reportedIds = Array.from(new Set(reports.map((r) => r.reported_id)));

  const [{ data: profiles }, { data: ratings }, { data: allAgainst }, statuses] =
    await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("clerk_user_id, display_name")
        .in("clerk_user_id", userIds),
      supabaseAdmin.from("ratings").select("ratee_id, score").in("ratee_id", reportedIds),
      // Every report against these users, any status - the repeat signal is
      // lifetime, not just what is currently open.
      supabaseAdmin.from("reports").select("reported_id").in("reported_id", reportedIds),
      statusesByUser(),
    ]);

  const nameById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.display_name])
  );

  const scoresByUser = new Map<string, number[]>();
  for (const row of ratings ?? []) {
    const list = scoresByUser.get(row.ratee_id) ?? [];
    list.push(row.score);
    scoresByUser.set(row.ratee_id, list);
  }

  const againstCount = new Map<string, number>();
  for (const row of allAgainst ?? []) {
    againstCount.set(row.reported_id, (againstCount.get(row.reported_id) ?? 0) + 1);
  }

  const value = reports.map((r) => ({
    id: r.id,
    reason: r.reason,
    createdAt: r.created_at,
    reporterId: r.reporter_id,
    reporterName: nameById.get(r.reporter_id) ?? "Unknown",
    reportedId: r.reported_id,
    reportedName: nameById.get(r.reported_id) ?? "Unknown",
    reportedFlag: computeRatingFlag(
      aggregateRating(scoresByUser.get(r.reported_id) ?? [])
    ),
    reportedStatus:
      statuses.get(r.reported_id) ?? ("active" as ModerationStatus),
    reportsAgainstCount: againstCount.get(r.reported_id) ?? 0,
  }));

  return { ok: true, value };
}

/**
 * The action log, newest first. This is the state-transition evidence: every
 * warning, suspension and lift, with who issued it.
 */
export async function getActionLog(limit = 50): Promise<ActionLogEntry[]> {
  const { data, error } = await supabaseAdmin
    .from("moderation_actions")
    .select(
      "id, target_user_id, admin_id, action, reason, expires_at, report_id, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("action log fetch failed:", error);
    return [];
  }
  if (!data?.length) return [];

  // admin_id is SET NULL, so a deleted admin's actions survive with a null
  // actor - filter before the lookup rather than passing null into .in().
  const ids = Array.from(
    new Set(
      data.flatMap((a) => [a.target_user_id, a.admin_id]).filter(Boolean)
    )
  ) as string[];

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, display_name")
    .in("clerk_user_id", ids);

  const nameById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.display_name])
  );

  return data.map((a) => ({
    id: a.id,
    action: a.action,
    reason: a.reason,
    createdAt: a.created_at,
    expiresAt: a.expires_at,
    reportId: a.report_id,
    targetName: nameById.get(a.target_user_id) ?? "Unknown",
    adminName: a.admin_id ? nameById.get(a.admin_id) ?? "Unknown" : "Former admin",
  }));
}

/**
 * Written feedback about several users at once.
 *
 * Feature 6 stores review text but never shows it to the person it is about,
 * explicitly so it can serve as moderation input, this is that consumer.
 *
 * rater_id is deliberately NOT selected: the admin needs to know what was
 * said, not who said it. In a 1:1 session the rater is identifiable from the
 * session anyway, but not surfacing the name keeps the dashboard from being
 * the thing that makes the privacy promise hollow.
 *
 * Batched because the flagged-users table needs reviews per row, and one query
 * per row is a round trip per user.
 */
export async function getReviewsForUsers(
  userIds: string[]
): Promise<Map<string, ReviewEntry[]>> {
  const result = new Map<string, ReviewEntry[]>();
  if (!userIds.length) return result;

  const { data, error } = await supabaseAdmin
    .from("ratings")
    .select("ratee_id, score, review, created_at")
    .in("ratee_id", userIds)
    .not("review", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("review fetch failed:", error);
    return result;
  }

  for (const row of data ?? []) {
    const list = result.get(row.ratee_id) ?? [];
    list.push({
      score: row.score,
      review: row.review as string,
      createdAt: row.created_at,
    });
    result.set(row.ratee_id, list);
  }

  return result;
}

export async function getReviewsForUser(userId: string): Promise<ReviewEntry[]> {
  const map = await getReviewsForUsers([userId]);
  return map.get(userId) ?? [];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [totalUsers, openReports, flagged, statuses] = await Promise.all([
    supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
    supabaseAdmin
      .from("reports")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    getFlaggedUsers(),
    statusesByUser(),
  ]);

  let activeSuspensions = 0;
  for (const status of statuses.values()) {
    if (status === "suspended") activeSuspensions += 1;
  }

  return {
    totalUsers: totalUsers.count ?? 0,
    openReports: openReports.count ?? 0,
    flaggedUsers: flagged.ok ? flagged.value.length : 0,
    activeSuspensions,
  };
}