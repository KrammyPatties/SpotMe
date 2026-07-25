// lib/ratings.test.ts

import { describe, it, expect } from "vitest";
import {
  validateRatingSubmission,
  aggregateRating,
  scoreRating,
  pendingRatees,
  RATING_PRIOR,
} from "./ratings";

const RATER = "user_rater";
const SESSION = "11111111-1111-4111-8111-111111111111";

function submission(overrides: Record<string, unknown> = {}) {
  return {
    session_id: SESSION,
    ratings: [{ ratee_id: "user_partner", score: 4, review: "Great spotter" }],
    ...overrides,
  };
}

describe("validateRatingSubmission", () => {
  it("accepts a valid single rating", () => {
    const result = validateRatingSubmission(submission(), RATER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ratings).toHaveLength(1);
      expect(result.value.ratings[0].score).toBe(4);
    }
  });

  it("accepts a batch rating several people", () => {
    const result = validateRatingSubmission(
      submission({
        ratings: [
          { ratee_id: "user_a", score: 5, review: null },
          { ratee_id: "user_b", score: 3, review: "Late" },
        ],
      }),
      RATER
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ratings).toHaveLength(2);
  });

  it("collapses a whitespace-only review to null", () => {
    const result = validateRatingSubmission(
      submission({
        ratings: [{ ratee_id: "user_partner", score: 4, review: "   " }],
      }),
      RATER
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ratings[0].review).toBeNull();
  });

  it("accepts an omitted review", () => {
    const result = validateRatingSubmission(
      submission({ ratings: [{ ratee_id: "user_partner", score: 4 }] }),
      RATER
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ratings[0].review).toBeNull();
  });

  it("rejects a non-object payload", () => {
    expect(validateRatingSubmission(null, RATER).ok).toBe(false);
    expect(validateRatingSubmission("nope", RATER).ok).toBe(false);
  });

  it("rejects a malformed session_id", () => {
    const result = validateRatingSubmission(
      submission({ session_id: "not-a-uuid" }),
      RATER
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an empty ratings array", () => {
    const result = validateRatingSubmission(
      submission({ ratings: [] }),
      RATER
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a score outside 1-5", () => {
    for (const score of [0, 6, -1]) {
      const result = validateRatingSubmission(
        submission({ ratings: [{ ratee_id: "user_partner", score }] }),
        RATER
      );
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a fractional score", () => {
    const result = validateRatingSubmission(
      submission({ ratings: [{ ratee_id: "user_partner", score: 4.5 }] }),
      RATER
    );
    expect(result.ok).toBe(false);
  });

  it("rejects self-rating", () => {
    const result = validateRatingSubmission(
      submission({ ratings: [{ ratee_id: RATER, score: 5 }] }),
      RATER
    );
    expect(result.ok).toBe(false);
  });

  it("rejects the same person rated twice in one submission", () => {
    const result = validateRatingSubmission(
      submission({
        ratings: [
          { ratee_id: "user_a", score: 5 },
          { ratee_id: "user_a", score: 2 },
        ],
      }),
      RATER
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an over-long review", () => {
    const result = validateRatingSubmission(
      submission({
        ratings: [
          { ratee_id: "user_partner", score: 4, review: "x".repeat(1001) },
        ],
      }),
      RATER
    );
    expect(result.ok).toBe(false);
  });

  // Clerk IDs are text, not UUIDs — a plain string must be accepted.
  it("accepts a non-UUID ratee_id", () => {
    const result = validateRatingSubmission(
      submission({
        ratings: [{ ratee_id: "user_2abcDEF123", score: 5 }],
      }),
      RATER
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an empty ratee_id", () => {
    const result = validateRatingSubmission(
      submission({ ratings: [{ ratee_id: "  ", score: 5 }] }),
      RATER
    );
    expect(result.ok).toBe(false);
  });
});

describe("aggregateRating", () => {
  it("returns the neutral prior when unrated", () => {
    const agg = aggregateRating([]);
    expect(agg.count).toBe(0);
    expect(agg.mean).toBeNull();
    expect(agg.adjusted).toBe(RATING_PRIOR);
  });

  // (3 x 3 + 5) / (3 + 1) = 14 / 4
  it("shrinks a single 5-star rating toward neutral", () => {
    const agg = aggregateRating([5]);
    expect(agg.mean).toBe(5);
    expect(agg.adjusted).toBeCloseTo(3.5, 5);
  });

  // (9 + 50) / 13
  it("moves closer to the true mean as ratings accumulate", () => {
    const agg = aggregateRating(Array(10).fill(5));
    expect(agg.mean).toBe(5);
    expect(agg.adjusted).toBeCloseTo(4.538, 3);
  });

  it("leaves an all-neutral history exactly at the prior", () => {
    const agg = aggregateRating([3, 3, 3, 3]);
    expect(agg.adjusted).toBeCloseTo(RATING_PRIOR, 5);
  });

  // (9 + 1) / 4 — one bad rating doesn't sink someone to the floor either.
  it("shrinks a single 1-star rating toward neutral", () => {
    const agg = aggregateRating([1]);
    expect(agg.adjusted).toBeCloseTo(2.5, 5);
  });

  it("keeps adjusted within the score range", () => {
    expect(aggregateRating(Array(200).fill(5)).adjusted).toBeLessThanOrEqual(5);
    expect(aggregateRating(Array(200).fill(1)).adjusted).toBeGreaterThanOrEqual(1);
  });
});

describe("scoreRating", () => {
  // The cold-start guard: unrated must be mid-scale, not zero.
  it("maps the neutral prior to 0.5", () => {
    expect(scoreRating(RATING_PRIOR)).toBeCloseTo(0.5, 5);
  });

  it("maps the range endpoints to 0 and 1", () => {
    expect(scoreRating(1)).toBe(0);
    expect(scoreRating(5)).toBe(1);
  });

  it("clamps out-of-range input", () => {
    expect(scoreRating(0)).toBe(0);
    expect(scoreRating(9)).toBe(1);
  });

  it("is monotonic", () => {
    expect(scoreRating(4)).toBeGreaterThan(scoreRating(3));
  });

  it("gives an unrated user exactly 0.5 end to end", () => {
    expect(scoreRating(aggregateRating([]).adjusted)).toBeCloseTo(0.5, 5);
  });
});

describe("pendingRatees", () => {
  it("returns every other member when nothing is rated", () => {
    const pending = pendingRatees(["me", "a", "b"], "me", []);
    expect(pending).toEqual(["a", "b"]);
  });

  it("excludes the rater", () => {
    expect(pendingRatees(["me", "a"], "me", [])).not.toContain("me");
  });

  it("excludes people already rated", () => {
    const pending = pendingRatees(["me", "a", "b"], "me", [{ ratee_id: "a" }]);
    expect(pending).toEqual(["b"]);
  });

  it("returns empty when the rater is done", () => {
    const pending = pendingRatees(
      ["me", "a", "b"],
      "me",
      [{ ratee_id: "a" }, { ratee_id: "b" }]
    );
    expect(pending).toEqual([]);
  });

  it("returns empty for a solo room", () => {
    expect(pendingRatees(["me"], "me", [])).toEqual([]);
  });
});
