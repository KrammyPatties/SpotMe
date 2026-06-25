import type { Candidate } from "./supabase/candidates";
/**
 * The user we're matching FOR. Same as a Candidate, plus their match
 * preferences (which only the user side of scoring needs - candidates
 * are never scored on their own preferences).
 */

export type ScoringUser = Candidate & {
  preferred_experience: string[];
  preferred_gender: string[];
  preferred_styles: string[];
};

/**
 * Availability overlap score (0–1), measured from the USER's perspective:
 * the fraction of the user's availability slots that the candidate also has.
 *
 * Matchmaking is one-directional (we score candidates for the user), so we
 * ask "can this person meet me when I'm free" rather than a symmetric overlap.
 * Extra availability on the candidate's side does not lower the score.
 *
 * Returns 0 if either side has no availability (overlap undefined).
 */

export function scoreAvailability(user: ScoringUser, candidate: Candidate): number {
  if (user.availability.length === 0 || candidate.availability.length === 0) {
    return 0;
  }

  // Build a lookup of the candidate's slots for O(1) membership checks.
  const candidateSlots = new Set(
    candidate.availability.map((s) => `${s.day}-${s.time}`),
  );

  // Count how many of the user's slots the candidate also has.
  const shared = user.availability.filter((s) =>
    candidateSlots.has(`${s.day}-${s.time}`),
  ).length;

  return shared / user.availability.length;
}

/**
 * Gym compatibility (0-1):
 *   - share a home gym                              -> 1
 *   - else: nearest COMMON ActiveSG within radius   -> linear falloff, capped 0.75
 *   - else                                          -> 0
 *
 * "Common ActiveSG" = an ActiveSG gym within radiusKm of BOTH people's nearest
 * home gym. We pick the one minimising the WORSE of the two distances (so
 * neither person is left far), and fall off linearly with that worst distance.
 * Capped at 0.75 so a real shared home gym (1) always ranks higher.
 */

/** Result of gym scoring: the score, plus the common ActiveSG gym name if
 *  proximity (not a shared home gym) is what produced the score. */
export type GymScore = { score: number; sharedActiveSg: string | null };

export function scoreSharedGym(
  user: ScoringUser,
  candidate: Candidate,
  ctx: ScoringContext,
): GymScore {
  // 1. Shared home gym -> perfect (no ActiveSG anchor needed)
  if (user.gyms.length > 0 && candidate.gyms.length > 0) {
    const candidateGymIds = new Set(candidate.gyms.map((g) => g.id));
    if (user.gyms.some((g) => candidateGymIds.has(g.id))) {
      return { score: 1, sharedActiveSg: null };
    }
  }

  // 2. ActiveSG fallback
  const userAnchors = user.gyms.filter((g) => g.latitude != null && g.longitude != null);
  const candAnchors = candidate.gyms.filter((g) => g.latitude != null && g.longitude != null);
  if (userAnchors.length === 0 || candAnchors.length === 0 || ctx.activeSgGyms.length === 0) {
    return { score: 0, sharedActiveSg: null };
  }

  let bestWorstDistance = Infinity;
  let bestGymName: string | null = null;
  for (const asg of ctx.activeSgGyms) {
    if (asg.latitude == null || asg.longitude == null) continue;
    const dUser = Math.min(...userAnchors.map((a) =>
      haversineKm(a.latitude!, a.longitude!, asg.latitude!, asg.longitude!)));
    const dCand = Math.min(...candAnchors.map((a) =>
      haversineKm(a.latitude!, a.longitude!, asg.latitude!, asg.longitude!)));
    const worst = Math.max(dUser, dCand);
    if (worst < bestWorstDistance) {
      bestWorstDistance = worst;
      bestGymName = asg.name;          // remember which gym
    }
  }

  if (bestWorstDistance > ctx.radiusKm) return { score: 0, sharedActiveSg: null };
  const falloff = 1 - bestWorstDistance / ctx.radiusKm;
  return { score: Math.min(falloff, 0.75), sharedActiveSg: bestGymName };
}

/** Extra context the gym scorer needs beyond the two people being compared. */
export type ScoringContext = {
  activeSgGyms: Candidate["gyms"];  // all ActiveSG gyms with coordinates
  radiusKm: number;                 // the user's match_radius_km
};

/**
 * Workout-style score (0–1, moderate tier):
 *   - both have the same real style        -> 1   (strong shared signal)
 *   - either is null or 'no_preference'     -> 0.5 (unknown / flexible: neutral)
 *   - both real but different               -> 0   (genuine mismatch)
 *
 * 'no_preference' / null means "open to anyone" - better than a mismatch, but
 * not the strong positive of two people who specifically share a style.
 */
export function scoreWorkoutStyle(user: ScoringUser, candidate: Candidate): number {
  const NEUTRAL = 0.5;

  // Either side undefined or flexible -> neutral, regardless of the other.
  if (
    user.workout_style == null || user.workout_style === "no_preference" ||
    candidate.workout_style == null || candidate.workout_style === "no_preference"
  ) {
    return NEUTRAL;
  }

  // Both have a real, specific style: match or not
  return user.workout_style === candidate.workout_style ? 1 : 0;
}

/**
 * Experience-preference score (0-1): is the candidate's experience level the same
 * as the user said they want to train with?
 *   - user has no preference (empty array) -> 1 (opted out: everyone passes)
 *   - candidate's experience is in the list -> 1
 *   - otherwise                              -> 0
 */
export function scoreExperiencePref(user: ScoringUser, candidate: Candidate): number {
  if (user.preferred_experience.length === 0) return 1; // no preference = accept all
  return user.preferred_experience.includes(candidate.experience) ? 1 : 0;
}

/**
 * Gender-preference score (0–1): is the candidate's gender the same as the user said
 * they want to train with? Same rule as experience.
 *   - user has no preference (empty array)        -> 1
 *   - candidate's gender is in the list           -> 1
 *   - candidate's gender is null but user has a pref -> 0 (can't confirm match)
 *   - otherwise                                   -> 0
 */
export function scoreGenderPref(user: ScoringUser, candidate: Candidate): number {
  if (user.preferred_gender.length === 0) return 1; // no preference = accept all
  if (candidate.gender == null) return 0;            // user cares, but gender unknown
  return user.preferred_gender.includes(candidate.gender) ? 1 : 0;
}

/**
 * Straight-line distance between two lat/lng points, in km
 * Standard haversine formula
 *
 * Used by the gym-distance fallback: when a user has no shared-gym matches,
 * we suggest gyms within their match_radius_km of a home gym.
 */

export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Weighted contribution of each signal to the total. Sums to 1 -> total is 0-1. */
const WEIGHTS = {
  availability: 0.30,   // dominant: can we meet at the same time
  sharedGym: 0.30,      // dominant: is there a place we'll both be
  workoutStyle: 0.15,   // moderate
  experiencePref: 0.15, // moderate
  genderPref: 0.10,     // light
} as const;

export type ScoredCandidate = {
  candidate: Candidate;
  score: number; // weighted total, 0-1
  breakdown: {
    availability: number;
    sharedGym: number;
    workoutStyle: number;
    experiencePref: number;
    genderPref: number;
  };
  sharedActiveSg: string | null;
};

/**
 * Scores one candidate against the user across all signals, returning the
 * candidate, a weighted total (0-1), and a per-signal breakdown.
 */
export function scoreCandidate(user: ScoringUser, candidate: Candidate, ctx: ScoringContext): ScoredCandidate {
  const gym = scoreSharedGym(user, candidate, ctx);   // { score, sharedActiveSg }

  const breakdown = {
    availability: scoreAvailability(user, candidate),
    sharedGym: gym.score,                              // ← use .score
    workoutStyle: scoreWorkoutStyle(user, candidate),
    experiencePref: scoreExperiencePref(user, candidate),
    genderPref: scoreGenderPref(user, candidate),
  };

  const score =
    breakdown.availability * WEIGHTS.availability +
    breakdown.sharedGym * WEIGHTS.sharedGym +
    breakdown.workoutStyle * WEIGHTS.workoutStyle +
    breakdown.experiencePref * WEIGHTS.experiencePref +
    breakdown.genderPref * WEIGHTS.genderPref;

  return { candidate, score, breakdown, sharedActiveSg: gym.sharedActiveSg };  // ← carry it through
}

/**
 * Scores every candidate against the user and returns them ranked best-first.
 */

export function rankCandidates(
  user: ScoringUser,
  candidates: Candidate[],
  ctx: ScoringContext,
): ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(user, candidate, ctx))
    .sort((a, b) => b.score - a.score); // descending: highest score first
}

/**
 * Distance fallback (pure): ActiveSG gyms within `radiusKm` of ANY of the
 * user's home gyms, sorted nearest-first, excluding gyms the user already
 * belongs to. Used by the match feed when no shared-gym matches
 * exist, to suggest places the user could go to find partners.
 *
 * Distance to a candidate gym = distance to the NEAREST user home gym.
 * Gyms without coordinates, non-ActiveSG gyms, and gyms the user is already
 * in are excluded.
 */

export function gymsInRange(
  userGyms: Candidate["gyms"],
  allGyms: Candidate["gyms"],
  radiusKm: number,
): Candidate["gyms"] {
  // Anchor points: the user's home gyms that actually have coordinates
  const anchors = userGyms.filter((g) => g.latitude != null && g.longitude != null);
  if (anchors.length === 0) return [];

  const userGymIds = new Set(userGyms.map((g) => g.id));

  return allGyms
    .filter((g) => g.chain === "ActiveSG")                  // ActiveSG only
    .filter((g) => !userGymIds.has(g.id))                   // not already a member
    .filter((g) => g.latitude != null && g.longitude != null) // has coordinates
    .map((g) => {
      // distance to the nearest home gym
      const nearest = Math.min(
        ...anchors.map((a) =>
          haversineKm(a.latitude!, a.longitude!, g.latitude!, g.longitude!),
        ),
      );
      return { gym: g, distance: nearest };
    })
    .filter((x) => x.distance <= radiusKm)                  // within radius
    .sort((a, b) => a.distance - b.distance)                // nearest first
    .map((x) => x.gym);
}