import { isUuid } from "@/lib/uuid";

/** Neutral score assumed for a user with no ratings yet (midpoint of 1-5). */
export const RATING_PRIOR = 3;

/**
 * Shrinkage weight - how many "virtual" prior ratings a user starts with.
 *
 * At C = 3, one 5-star rating lands you at 3.5 rather than 5; ten of them get
 * you to ~4.5. Confidence in the average scales with how much data backs it,
 * the same honesty guard decayForCount applies to the analytics trend fit.
 */
export const RATING_SHRINKAGE = 3;

export const MIN_SCORE = 1;
export const MAX_SCORE = 5;
export const MAX_REVIEW_LENGTH = 1000;

/** Sanity bound on a single submission - group chats are small. */
const MAX_RATINGS_PER_SUBMISSION = 20;

export type RatingInput = {
  ratee_id: string;
  score: number;
  review: string | null;
};

export type RatingSubmission = {
  session_id: string;
  ratings: RatingInput[];
};

export type ValidationResult =
  | { ok: true; value: RatingSubmission }
  | { ok: false; error: string };

export type RatingAggregate = {
  /** How many ratings this user has received. */
  count: number;
  /** Raw arithmetic mean, or null when unrated. UI formats it. */
  mean: number | null;
  /** Shrunk average - always in [1, 5], equals RATING_PRIOR when unrated. */
  adjusted: number;
};

/**
 * Validate a rating submission.
 *
 * The form rates every other member of a session in one submit, so the payload
 * is a batch: one session_id, many { ratee_id, score, review }.
 *
 * `raterId` is passed in (from the Clerk session at the route layer, never the
 * body) so self-rating is caught here rather than relying on the DB CHECK to
 * surface as a 500.
 */
export function validateRatingSubmission(
  payload: unknown,
  raterId: string
): ValidationResult {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Payload must be an object" };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.session_id !== "string" || !isUuid(p.session_id)) {
    return { ok: false, error: "session_id must be a valid UUID" };
  }

  if (!Array.isArray(p.ratings) || p.ratings.length === 0) {
    return { ok: false, error: "At least one rating is required" };
  }

  if (p.ratings.length > MAX_RATINGS_PER_SUBMISSION) {
    return {
      ok: false,
      error: `At most ${MAX_RATINGS_PER_SUBMISSION} ratings per submission`,
    };
  }

  const seen = new Set<string>();
  const normalised: RatingInput[] = [];

  for (const raw of p.ratings) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "Each rating must be an object" };
    }

    const r = raw as Record<string, unknown>;

    // Clerk user IDs are text, not UUIDs - do not validate them as UUIDs.
    if (typeof r.ratee_id !== "string" || r.ratee_id.trim().length === 0) {
      return { ok: false, error: "ratee_id must be a non-empty string" };
    }

    const rateeId = r.ratee_id;

    if (rateeId === raterId) {
      return { ok: false, error: "You cannot rate yourself" };
    }

    if (seen.has(rateeId)) {
      return { ok: false, error: "Each person can only be rated once" };
    }
    seen.add(rateeId);

    if (
      typeof r.score !== "number" ||
      !Number.isInteger(r.score) ||
      r.score < MIN_SCORE ||
      r.score > MAX_SCORE
    ) {
      return {
        ok: false,
        error: `score must be a whole number from ${MIN_SCORE} to ${MAX_SCORE}`,
      };
    }

    // Written feedback is optional; whitespace-only collapses to null so the
    // column holds null rather than " ".
    let review: string | null = null;
    if (r.review !== null && r.review !== undefined) {
      if (typeof r.review !== "string") {
        return { ok: false, error: "review must be a string or null" };
      }
      const trimmed = r.review.trim();
      if (trimmed.length > MAX_REVIEW_LENGTH) {
        return {
          ok: false,
          error: `review must be at most ${MAX_REVIEW_LENGTH} characters`,
        };
      }
      review = trimmed.length ? trimmed : null;
    }

    normalised.push({ ratee_id: rateeId, score: r.score, review });
  }

  return { ok: true, value: { session_id: p.session_id, ratings: normalised } };
}

/**
 * Bayesian-shrunk average of the scores a user has received.
 *
 *   adjusted = (C x prior + sum) / (C + n)
 *
 * The cold-start problem this solves: if an unrated user scored 0 on a
 * 0.20-weight signal they would sink to the bottom of every feed, never get
 * matched, never get rated, and stay buried permanently. A neutral prior means
 * unrated is *average*, not worst, and real ratings pull away from neutral in
 * proportion to how many there are.
 */
export function aggregateRating(scores: number[]): RatingAggregate {
  const count = scores.length;

  if (count === 0) {
    return { count: 0, mean: null, adjusted: RATING_PRIOR };
  }

  const sum = scores.reduce((acc, s) => acc + s, 0);

  return {
    count,
    mean: sum / count,
    adjusted:
      (RATING_SHRINKAGE * RATING_PRIOR + sum) / (RATING_SHRINKAGE + count),
  };
}

/**
 * Normalise a shrunk average to the 0-1 range the scoring engine expects.
 *
 * Consumed by scoreCandidate in sub-issue C. Lives here because what a rating
 * *means* belongs with the rating logic, not the matching weights.
 *
 * The load-bearing property: an unrated user's RATING_PRIOR of 3 maps to
 * exactly 0.5 - mid-scale, neither rewarded nor punished.
 */
export function scoreRating(adjusted: number): number {
  const clamped = Math.min(Math.max(adjusted, MIN_SCORE), MAX_SCORE);
  return (clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE);
}

/**
 * Which members of a session this rater still owes a rating.
 *
 * `completed` means "the session happened", not "everyone has rated it".
 * Whether a rating is outstanding is derived per viewer, so one person never
 * rating can't freeze the session in the other person's chatroom.
 *
 * An empty result means this rater is done with this session.
 */
export function pendingRatees(
  memberIds: string[],
  raterId: string,
  existingRatings: { ratee_id: string }[]
): string[] {
  const alreadyRated = new Set(existingRatings.map((r) => r.ratee_id));
  return memberIds.filter((id) => id !== raterId && !alreadyRated.has(id));
}
