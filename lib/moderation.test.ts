import { describe, it, expect } from "vitest";
import { aggregateRating } from "@/lib/ratings";
import {
  computeRatingFlag,
  currentModerationStatus,
  computeSuspensionExpiry,
  validateModerationAction,
  validateReportResolution,
  validateReportSubmission,
  type ModerationActionRecord,
} from "@/lib/moderation";

const ADMIN = "user_admin";
const TARGET = "user_target";
const NOW = new Date("2026-07-26T12:00:00.000Z");

function action(
  over: Partial<ModerationActionRecord> = {}
): ModerationActionRecord {
  return {
    action: "warning",
    expires_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

describe("computeRatingFlag", () => {
  it("reports an unrated user as unrated, not ok", () => {
    expect(computeRatingFlag(aggregateRating([]))).toBe("unrated");
  });

  it("never flags a user on a single rating, even a 1-star", () => {
    const agg = aggregateRating([1]);
    expect(agg.adjusted).toBeCloseTo(10 / 3, 10);
    expect(computeRatingFlag(agg)).toBe("ok");
  });

  it("flags two 1-stars as watch", () => {
    const agg = aggregateRating([1, 1]);
    expect(agg.adjusted).toBe(2.75);
    expect(computeRatingFlag(agg)).toBe("watch");
  });

  it("does not flag at exactly 3.0 - the threshold is strict", () => {
    const agg = aggregateRating([1, 2]);
    expect(agg.adjusted).toBe(3);
    expect(computeRatingFlag(agg)).toBe("ok");
  });

  it("escalates three 1-stars to severe", () => {
    const agg = aggregateRating([1, 1, 1]);
    expect(agg.adjusted).toBe(2.4);
    expect(computeRatingFlag(agg)).toBe("severe");
  });

  it("does not escalate at exactly 2.5 - the threshold is strict", () => {
    const agg = aggregateRating([1, 1, 2, 2]);
    expect(agg.adjusted).toBe(2.5);
    expect(computeRatingFlag(agg)).toBe("watch");
  });

  it("leaves a well-rated user unflagged", () => {
    expect(computeRatingFlag(aggregateRating([5, 5, 5, 5, 5]))).toBe("ok");
  });

  it("still flags a long bad history as the threshold converges on 3", () => {
    expect(computeRatingFlag(aggregateRating([2, 2, 3, 3, 2, 3]))).toBe("ok");
    expect(computeRatingFlag(aggregateRating([2, 2, 3, 3, 2, 3, 1]))).toBe(
      "watch"
    );
  });
});

describe("currentModerationStatus", () => {
  it("treats a user with no actions as active", () => {
    expect(currentModerationStatus([], NOW)).toBe("active");
  });

  it("reports a warned user as warned", () => {
    expect(currentModerationStatus([action({ action: "warning" })], NOW)).toBe(
      "warned"
    );
  });

  it("reports an unexpired suspension as suspended", () => {
    const a = action({
      action: "suspension",
      expires_at: "2026-08-10T00:00:00.000Z",
      created_at: "2026-07-20T00:00:00.000Z",
    });
    expect(currentModerationStatus([a], NOW)).toBe("suspended");
  });

  it("returns an expired suspension to active - it has been served", () => {
    const a = action({
      action: "suspension",
      expires_at: "2026-07-20T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
    });
    expect(currentModerationStatus([a], NOW)).toBe("active");
  });

  it("lets a lift override an unexpired suspension", () => {
    const actions = [
      action({
        action: "suspension",
        expires_at: "2026-08-10T00:00:00.000Z",
        created_at: "2026-07-20T00:00:00.000Z",
      }),
      action({ action: "lift", created_at: "2026-07-22T00:00:00.000Z" }),
    ];
    expect(currentModerationStatus(actions, NOW)).toBe("active");
  });

  it("does not depend on the order the log is passed in", () => {
    const suspension = action({
      action: "suspension",
      expires_at: "2026-08-10T00:00:00.000Z",
      created_at: "2026-07-20T00:00:00.000Z",
    });
    const lift = action({
      action: "lift",
      created_at: "2026-07-22T00:00:00.000Z",
    });
    expect(currentModerationStatus([suspension, lift], NOW)).toBe("active");
    expect(currentModerationStatus([lift, suspension], NOW)).toBe("active");
  });

  it("re-suspends when a suspension follows a lift", () => {
    const actions = [
      action({ action: "lift", created_at: "2026-07-22T00:00:00.000Z" }),
      action({
        action: "suspension",
        expires_at: "2026-08-10T00:00:00.000Z",
        created_at: "2026-07-24T00:00:00.000Z",
      }),
    ];
    expect(currentModerationStatus(actions, NOW)).toBe("suspended");
  });

  it("fails closed on a suspension with a missing expiry", () => {
    const a = action({ action: "suspension", expires_at: null });
    expect(currentModerationStatus([a], NOW)).toBe("suspended");
  });
});

describe("computeSuspensionExpiry", () => {
  it("adds whole days in UTC", () => {
    expect(computeSuspensionExpiry(NOW, 7)).toBe("2026-08-02T12:00:00.000Z");
  });
});

describe("validateModerationAction", () => {
  it("rejects a non-object payload", () => {
    const r = validateModerationAction(null, ADMIN, NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects an empty target_user_id", () => {
    const r = validateModerationAction(
      { target_user_id: "  ", action: "warning", reason: "spam" },
      ADMIN,
      NOW
    );
    expect(r.ok).toBe(false);
  });

  it("rejects self-moderation", () => {
    const r = validateModerationAction(
      { target_user_id: ADMIN, action: "warning", reason: "spam" },
      ADMIN,
      NOW
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/yourself/);
  });

  it("rejects an unknown action", () => {
    const r = validateModerationAction(
      { target_user_id: TARGET, action: "ban", reason: "spam" },
      ADMIN,
      NOW
    );
    expect(r.ok).toBe(false);
  });

  it("requires a reason", () => {
    const r = validateModerationAction(
      { target_user_id: TARGET, action: "warning", reason: "   " },
      ADMIN,
      NOW
    );
    expect(r.ok).toBe(false);
  });

  it("accepts a warning and leaves expires_at null", () => {
    const r = validateModerationAction(
      { target_user_id: TARGET, action: "warning", reason: " rude in chat " },
      ADMIN,
      NOW
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.expires_at).toBeNull();
      expect(r.value.reason).toBe("rude in chat");
      expect(r.value.report_id).toBeNull();
    }
  });

  it("computes expires_at for a suspension", () => {
    const r = validateModerationAction(
      { target_user_id: TARGET, action: "suspension", reason: "abuse", days: 7 },
      ADMIN,
      NOW
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.expires_at).toBe("2026-08-02T12:00:00.000Z");
  });

  it("requires days on a suspension", () => {
    const r = validateModerationAction(
      { target_user_id: TARGET, action: "suspension", reason: "abuse" },
      ADMIN,
      NOW
    );
    expect(r.ok).toBe(false);
  });

  it("rejects an out-of-range suspension length", () => {
    for (const days of [0, 91, 2.5]) {
      const r = validateModerationAction(
        { target_user_id: TARGET, action: "suspension", reason: "abuse", days },
        ADMIN,
        NOW
      );
      expect(r.ok).toBe(false);
    }
  });

  it("rejects days supplied alongside a warning", () => {
    const r = validateModerationAction(
      { target_user_id: TARGET, action: "warning", reason: "rude", days: 7 },
      ADMIN,
      NOW
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/suspension/);
  });

  it("rejects a malformed report_id but accepts null", () => {
    const bad = validateModerationAction(
      {
        target_user_id: TARGET,
        action: "warning",
        reason: "rude",
        report_id: "not-a-uuid",
      },
      ADMIN,
      NOW
    );
    expect(bad.ok).toBe(false);

    const good = validateModerationAction(
      {
        target_user_id: TARGET,
        action: "warning",
        reason: "rude",
        report_id: null,
      },
      ADMIN,
      NOW
    );
    expect(good.ok).toBe(true);
  });
});

describe("validateReportResolution", () => {
  it("accepts actioned and dismissed from open", () => {
    expect(validateReportResolution("open", "actioned").ok).toBe(true);
    expect(validateReportResolution("open", "dismissed").ok).toBe(true);
  });

  it("rejects an unknown decision", () => {
    expect(validateReportResolution("open", "resolved").ok).toBe(false);
  });

  it("rejects a transition out of a terminal state", () => {
    const r = validateReportResolution("actioned", "dismissed");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/already actioned/);
  });

  it("rejects reopening", () => {
    expect(validateReportResolution("dismissed", "actioned").ok).toBe(false);
  });
});

describe("validateReportSubmission", () => {
  const REPORTER = "user_reporter";

  it("rejects a non-object payload", () => {
    expect(validateReportSubmission(null, REPORTER).ok).toBe(false);
  });

  it("rejects an empty reported_id", () => {
    const r = validateReportSubmission(
      { reported_id: "   ", reason: "harassment" },
      REPORTER
    );
    expect(r.ok).toBe(false);
  });

  it("rejects self-reporting", () => {
    const r = validateReportSubmission(
      { reported_id: REPORTER, reason: "harassment" },
      REPORTER
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/yourself/);
  });

  it("requires a reason", () => {
    const r = validateReportSubmission(
      { reported_id: TARGET, reason: "  " },
      REPORTER
    );
    expect(r.ok).toBe(false);
  });

  it("rejects an over-long reason", () => {
    const r = validateReportSubmission(
      { reported_id: TARGET, reason: "x".repeat(1001) },
      REPORTER
    );
    expect(r.ok).toBe(false);
  });

  it("accepts a valid report and trims the reason", () => {
    const r = validateReportSubmission(
      { reported_id: TARGET, reason: "  sent abusive messages  " },
      REPORTER
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.reported_id).toBe(TARGET);
      expect(r.value.reason).toBe("sent abusive messages");
    }
  });
});