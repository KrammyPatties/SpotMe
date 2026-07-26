import { isUuid } from "@/lib/uuid";
import type { RatingAggregate } from "@/lib/ratings";

export const RATING_FLAG_WATCH = 3;
export const RATING_FLAG_SEVERE = 2.5;

export const MIN_SUSPENSION_DAYS = 1;
export const MAX_SUSPENSION_DAYS = 90;
export const MAX_REASON_LENGTH = 1000;

const DAY_MS = 86_400_000;

export type RatingFlag = "unrated" | "ok" | "watch" | "severe";

export type ModerationStatus = "active" | "warned" | "suspended";

export type ModerationActionType = "warning" | "suspension" | "lift";

const ACTION_TYPES: ModerationActionType[] = ["warning", "suspension", "lift"];

export type ModerationActionRecord = {
  action: ModerationActionType;
  expires_at: string | null;
  created_at: string;
};

export type ModerationActionInput = {
  target_user_id: string;
  action: ModerationActionType;
  reason: string;
  expires_at: string | null;
  report_id: string | null;
};

export type ModerationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type ReportDecision = "actioned" | "dismissed";

const DECISIONS: ReportDecision[] = ["actioned", "dismissed"];

/**
 * Classify a user's rating history for the moderation queue.
 *
 * Takes the whole aggregate rather than a bare number so the count is
 * available for the unrated case and callers can't accidentally pass a raw
 * mean where a shrunk average is expected.
 */
export function computeRatingFlag(aggregate: RatingAggregate): RatingFlag {
  if (aggregate.count === 0) return "unrated";
  if (aggregate.adjusted < RATING_FLAG_SEVERE) return "severe";
  if (aggregate.adjusted < RATING_FLAG_WATCH) return "watch";
  return "ok";
}


// Derive a user's enforcement status from their action log.
export function currentModerationStatus(
  actions: ModerationActionRecord[],
  now: Date = new Date()
): ModerationStatus {
  if (!actions.length) return "active";

  const latest = [...actions].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
  )[0];

  if (latest.action === "suspension") {
    const expiry = latest.expires_at ? Date.parse(latest.expires_at) : NaN;
    // An unparseable or missing expiry on a suspension should not silently
    // free the user as the DB CHECK makes it impossible, so treat it as active
    // enforcement rather than trusting the bad row.
    if (Number.isNaN(expiry)) return "suspended";
    return expiry > now.getTime() ? "suspended" : "active";
  }

  if (latest.action === "warning") return "warned";

  return "active"; // lift
}


// Expiry timestamp for a suspension of how many days from 'now'.
export function computeSuspensionExpiry(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}


// Validate an admin action and normalise it into an insertable row.
export function validateModerationAction(
  payload: unknown,
  adminId: string,
  now: Date = new Date()
): ModerationResult<ModerationActionInput> {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Payload must be an object" };
  }

  const p = payload as Record<string, unknown>;

  if (
    typeof p.target_user_id !== "string" ||
    p.target_user_id.trim().length === 0
  ) {
    return { ok: false, error: "target_user_id must be a non-empty string" };
  }

  const targetUserId = p.target_user_id;

  if (targetUserId === adminId) {
    return { ok: false, error: "You cannot moderate yourself" };
  }

  if (!ACTION_TYPES.includes(p.action as ModerationActionType)) {
    return {
      ok: false,
      error: "action must be 'warning', 'suspension' or 'lift'",
    };
  }

  const action = p.action as ModerationActionType;

  if (typeof p.reason !== "string" || p.reason.trim().length === 0) {
    return { ok: false, error: "reason is required" };
  }

  const reason = p.reason.trim();

  if (reason.length > MAX_REASON_LENGTH) {
    return {
      ok: false,
      error: `reason must be at most ${MAX_REASON_LENGTH} characters`,
    };
  }

  const hasDays = p.days !== undefined && p.days !== null;

  let expiresAt: string | null = null;

  if (action === "suspension") {
    if (
      typeof p.days !== "number" ||
      !Number.isInteger(p.days) ||
      p.days < MIN_SUSPENSION_DAYS ||
      p.days > MAX_SUSPENSION_DAYS
    ) {
      return {
        ok: false,
        error: `days must be a whole number from ${MIN_SUSPENSION_DAYS} to ${MAX_SUSPENSION_DAYS}`,
      };
    }
    expiresAt = computeSuspensionExpiry(now, p.days);
  } else if (hasDays) {
    return { ok: false, error: `days is only valid for a suspension` };
  }

  let reportId: string | null = null;
  if (p.report_id !== undefined && p.report_id !== null) {
    if (typeof p.report_id !== "string" || !isUuid(p.report_id)) {
      return { ok: false, error: "report_id must be a valid UUID or null" };
    }
    reportId = p.report_id;
  }

  return {
    ok: true,
    value: {
      target_user_id: targetUserId,
      action,
      reason,
      expires_at: expiresAt,
      report_id: reportId,
    },
  };
}

export function validateReportResolution(
  currentStatus: string,
  decision: unknown
): ModerationResult<ReportDecision> {
  if (!DECISIONS.includes(decision as ReportDecision)) {
    return {
      ok: false,
      error: "decision must be 'actioned' or 'dismissed'",
    };
  }

  if (currentStatus !== "open") {
    return {
      ok: false,
      error: `Report is already ${currentStatus}`,
    };
  }

  return { ok: true, value: decision as ReportDecision };
}

export type ReportSubmission = {
  reported_id: string;
  reason: string;
};

// Validate a user-filed report.
export function validateReportSubmission(
  payload: unknown,
  reporterId: string
): ModerationResult<ReportSubmission> {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Payload must be an object" };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.reported_id !== "string" || p.reported_id.trim().length === 0) {
    return { ok: false, error: "reported_id must be a non-empty string" };
  }

  const reportedId = p.reported_id;

  if (reportedId === reporterId) {
    return { ok: false, error: "You cannot report yourself" };
  }

  if (typeof p.reason !== "string" || p.reason.trim().length === 0) {
    return { ok: false, error: "reason is required" };
  }

  const reason = p.reason.trim();

  if (reason.length > MAX_REASON_LENGTH) {
    return {
      ok: false,
      error: `reason must be at most ${MAX_REASON_LENGTH} characters`,
    };
  }

  return { ok: true, value: { reported_id: reportedId, reason } };
}