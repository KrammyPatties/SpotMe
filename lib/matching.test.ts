import { describe, it, expect } from "vitest";
import {
  scoreAvailability,
  scoreSharedGym,
  scoreWorkoutStyle,
  scoreExperiencePref,
  scoreGenderPref,
  type ScoringUser,
  haversineKm,
  scoreCandidate,
  rankCandidates,
  gymsInRange
} from "./matching";
import type { Candidate } from "./supabase/candidates";

// Helper: build a minimal candidate with just the fields a test needs.
function makeUser(overrides: Partial<ScoringUser> = {}): ScoringUser {
  return {
    clerk_user_id: "test",
    display_name: "Test",
    age: null,
    experience: "beginner",
    gender: null,
    bio: null,
    workout_style: null,
    gyms: [],
    availability: [],
    preferred_experience: [],
    preferred_gender: [],
    preferred_styles: [],
    photo_path: null,
    match_radius_km: 5,
    ...overrides,
  };
}

// Helper: a gym with a given id.
function gym(id: string): Candidate["gyms"][number] {
  return { id, name: id, chain: "test", latitude: null, longitude: null };
}

// Helper: a gym with coordinates and a chain.
function geoGym(
  id: string, chain: string, lat: number, lng: number,
): Candidate["gyms"][number] {
  return { id, name: id, chain, latitude: lat, longitude: lng };
}

// Extra context the gym scorer needs beyond the two people being compared
const noCtx = { activeSgGyms: [], radiusKm: 10 };

// Tests for scoreAvailability function
describe("scoreAvailability", () => {
  it("returns 1 when the candidate shares all of the user's slots", () => {
    const user = makeUser({ availability: [{ day: 1, time: "evening" }, { day: 3, time: "morning" }] });
    const candidate = makeUser({ availability: [{ day: 1, time: "evening" }, { day: 3, time: "morning" }] });
    expect(scoreAvailability(user, candidate)).toBe(1);
  });

  it("returns 0.5 when the candidate shares half of the user's slots", () => {
    const user = makeUser({ availability: [{ day: 1, time: "evening" }, { day: 3, time: "morning" }] });
    const candidate = makeUser({ availability: [{ day: 1, time: "evening" }] });
    expect(scoreAvailability(user, candidate)).toBe(0.5);
  });

  it("returns 0 when there is no overlap", () => {
    const user = makeUser({ availability: [{ day: 1, time: "evening" }] });
    const candidate = makeUser({ availability: [{ day: 5, time: "morning" }] });
    expect(scoreAvailability(user, candidate)).toBe(0);
  });

  it("returns 0 when the user has no availability", () => {
    const user = makeUser({ availability: [] });
    const candidate = makeUser({ availability: [{ day: 1, time: "evening" }] });
    expect(scoreAvailability(user, candidate)).toBe(0);
  });

  it("returns 0 when the candidate has no availability", () => {
    const user = makeUser({ availability: [{ day: 1, time: "evening" }] });
    const candidate = makeUser({ availability: [] });
    expect(scoreAvailability(user, candidate)).toBe(0);
  });

  it("ignores candidate slots the user doesn't have (measures from user's slots)", () => {
    const user = makeUser({ availability: [{ day: 1, time: "evening" }] });
    const candidate = makeUser({ availability: [
      { day: 1, time: "evening" },
      { day: 2, time: "morning" },
      { day: 4, time: "evening" },
    ] });
    expect(scoreAvailability(user, candidate)).toBe(1);
  });
});

// Tests for scoreSharedGym function
describe("scoreSharedGym", () => {
  it("returns 1 when they share one gym", () => {
    const user = makeUser({ gyms: [gym("a")] });
    const candidate = makeUser({ gyms: [gym("a")] });
    expect(scoreSharedGym(user, candidate, noCtx).score).toBe(1);
  });

  it("returns 1 when they share at least one gym (binary, extra don't matter)", () => {
    const user = makeUser({ gyms: [gym("a"), gym("b")] });
    const candidate = makeUser({ gyms: [gym("b"), gym("c")] });
    expect(scoreSharedGym(user, candidate, noCtx).score).toBe(1);
  });

  it("returns 0 when they share no gyms", () => {
    const user = makeUser({ gyms: [gym("a")] });
    const candidate = makeUser({ gyms: [gym("b")] });
    expect(scoreSharedGym(user, candidate, noCtx).score).toBe(0);
  });

  it("returns 0 when the user has no gyms", () => {
    const user = makeUser({ gyms: [] });
    const candidate = makeUser({ gyms: [gym("a")] });
    expect(scoreSharedGym(user, candidate, noCtx).score).toBe(0);
  });

  it("returns 0 when the candidate has no gyms", () => {
    const user = makeUser({ gyms: [gym("a")] });
    const candidate = makeUser({ gyms: [] });
    expect(scoreSharedGym(user, candidate, noCtx).score).toBe(0);
  });
});

// Tests for new scoreWorkoutStyle function
describe("scoreWorkoutStyle", () => {
  it("returns 1 when both have the same real style", () => {
    const user = makeUser({ workout_style: "powerlifting" });
    const candidate = makeUser({ workout_style: "powerlifting" });
    expect(scoreWorkoutStyle(user, candidate)).toBe(1);
  });

  it("returns 0 when both have real but different styles", () => {
    const user = makeUser({ workout_style: "powerlifting" });
    const candidate = makeUser({ workout_style: "hiit" });
    expect(scoreWorkoutStyle(user, candidate)).toBe(0);
  });

  it("returns 0.5 when the user has no_preference", () => {
    const user = makeUser({ workout_style: "no_preference" });
    const candidate = makeUser({ workout_style: "hiit" });
    expect(scoreWorkoutStyle(user, candidate)).toBe(0.5);
  });

  it("returns 0.5 when the candidate has no_preference", () => {
    const user = makeUser({ workout_style: "powerlifting" });
    const candidate = makeUser({ workout_style: "no_preference" });
    expect(scoreWorkoutStyle(user, candidate)).toBe(0.5);
  });

  it("returns 0.5 when the user's style is null (not set)", () => {
    const user = makeUser({ workout_style: null });
    const candidate = makeUser({ workout_style: "hiit" });
    expect(scoreWorkoutStyle(user, candidate)).toBe(0.5);
  });

  it("returns 0.5 when the candidate's style is null (not set)", () => {
    const user = makeUser({ workout_style: "powerlifting" });
    const candidate = makeUser({ workout_style: null });
    expect(scoreWorkoutStyle(user, candidate)).toBe(0.5);
  });
});

// Tests for scoreExperiencePref function
describe("scoreExperiencePref", () => {
  it("returns 1 when the user has no experience preference (opted out)", () => {
    const user = makeUser({ preferred_experience: [] });
    const candidate = makeUser({ experience: "beginner" });
    expect(scoreExperiencePref(user, candidate)).toBe(1);
  });

  it("returns 1 when the candidate's experience is in the user's preferences", () => {
    const user = makeUser({ preferred_experience: ["advanced"] });
    const candidate = makeUser({ experience: "advanced" });
    expect(scoreExperiencePref(user, candidate)).toBe(1);
  });

  it("returns 1 when the candidate matches any one of several preferences", () => {
    const user = makeUser({ preferred_experience: ["intermediate", "advanced"] });
    const candidate = makeUser({ experience: "intermediate" });
    expect(scoreExperiencePref(user, candidate)).toBe(1);
  });

  it("returns 0 when the candidate's experience is not in the preferences", () => {
    const user = makeUser({ preferred_experience: ["advanced"] });
    const candidate = makeUser({ experience: "beginner" });
    expect(scoreExperiencePref(user, candidate)).toBe(0);
  });
});

// Tests for scoreGenderPref function
describe("scoreGenderPref", () => {
  it("returns 1 when the user has no gender preference (opted out)", () => {
    const user = makeUser({ preferred_gender: [] });
    const candidate = makeUser({ gender: "male" });
    expect(scoreGenderPref(user, candidate)).toBe(1);
  });

  it("returns 1 when the candidate's gender is in the user's preferences", () => {
    const user = makeUser({ preferred_gender: ["female"] });
    const candidate = makeUser({ gender: "female" });
    expect(scoreGenderPref(user, candidate)).toBe(1);
  });

  it("returns 0 when the candidate's gender is not in the preferences", () => {
    const user = makeUser({ preferred_gender: ["female"] });
    const candidate = makeUser({ gender: "male" });
    expect(scoreGenderPref(user, candidate)).toBe(0);
  });

  it("returns 0 when the user has a preference but the candidate's gender is null", () => {
    const user = makeUser({ preferred_gender: ["female"] });
    const candidate = makeUser({ gender: null });
    expect(scoreGenderPref(user, candidate)).toBe(0);
  });
});

// Tests for haversineKm function
describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(1.3521, 103.8198, 1.3521, 103.8198)).toBe(0);
  });

  it("computes a known Singapore distance within tolerance", () => {
    // Marina Bay (~1.2834, 103.8607) to Jurong East (~1.3329, 103.7436)
    // Real straight-line distance is roughly 14 km.
    const d = haversineKm(1.2834, 103.8607, 1.3329, 103.7436);
    expect(d).toBeGreaterThan(13);
    expect(d).toBeLessThan(15);
  });

  it("is symmetric (A -> B equals B -> A)", () => {
    const ab = haversineKm(1.28, 103.85, 1.35, 103.74);
    const ba = haversineKm(1.35, 103.74, 1.28, 103.85);
    expect(ab).toBeCloseTo(ba, 5);
  });
});

// Tests for scoreCandidate function (overall score combining all factors)
describe("scoreCandidate", () => {
  it("returns a breakdown with all five signals", () => {
    const user = makeUser();
    const candidate = makeUser();
    const result = scoreCandidate(user, candidate, noCtx);
    expect(result.breakdown).toHaveProperty("availability");
    expect(result.breakdown).toHaveProperty("sharedGym");
    expect(result.breakdown).toHaveProperty("workoutStyle");
    expect(result.breakdown).toHaveProperty("experiencePref");
    expect(result.breakdown).toHaveProperty("genderPref");
  });

  it("includes the candidate in the result", () => {
    const user = makeUser();
    const candidate = makeUser({ display_name: "Alice" });
    expect(scoreCandidate(user, candidate, noCtx).candidate.display_name).toBe("Alice");
  });

  it("scores a perfect match higher than a poor one", () => {
    const user = makeUser({
      availability: [{ day: 1, time: "evening" }],
      gyms: [gym("a")],
      workout_style: "powerlifting",
      preferred_experience: ["advanced"],
      preferred_gender: ["female"],
    });
    const perfect = makeUser({
      availability: [{ day: 1, time: "evening" }],
      gyms: [gym("a")],
      workout_style: "powerlifting",
      experience: "advanced",
      gender: "female",
    });
    const poor = makeUser({
      availability: [{ day: 5, time: "morning" }],
      gyms: [gym("z")],
      workout_style: "hiit",
      experience: "beginner",
      gender: "male",
    });
    expect(scoreCandidate(user, perfect, noCtx).score).toBeGreaterThan(
      scoreCandidate(user, poor, noCtx).score,
    );
  });

  it("gives a total score between 0 and 1", () => {
    const user = makeUser({ availability: [{ day: 1, time: "evening" }], gyms: [gym("a")] });
    const candidate = makeUser({ availability: [{ day: 1, time: "evening" }], gyms: [gym("a")] });
    const score = scoreCandidate(user, candidate, noCtx).score;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("a perfect match scores 1", () => {
    const user = makeUser({
      availability: [{ day: 1, time: "evening" }],
      gyms: [gym("a")],
      workout_style: "powerlifting",
      preferred_experience: ["advanced"],
      preferred_gender: ["female"],
    });
    const perfect = makeUser({
      availability: [{ day: 1, time: "evening" }],
      gyms: [gym("a")],
      workout_style: "powerlifting",
      experience: "advanced",
      gender: "female",
    });
    expect(scoreCandidate(user, perfect, noCtx).score).toBeCloseTo(1, 5);
  });
});

// Tests for rankCandidates function (sorting candidates by score)
describe("rankCandidates", () => {
  it("returns candidates sorted by score, highest first", () => {
    const user = makeUser({
      availability: [{ day: 1, time: "evening" }],
      gyms: [gym("a")],
    });
    const strong = makeUser({
      display_name: "Strong",
      availability: [{ day: 1, time: "evening" }],
      gyms: [gym("a")],
    });
    const weak = makeUser({
      display_name: "Weak",
      availability: [{ day: 5, time: "morning" }],
      gyms: [gym("z")],
    });

    const ranked = rankCandidates(user, [weak, strong], noCtx);
    expect(ranked[0].candidate.display_name).toBe("Strong");
    expect(ranked[1].candidate.display_name).toBe("Weak");
  });

  it("returns one ScoredCandidate per input candidate", () => {
    const user = makeUser();
    const ranked = rankCandidates(user, [makeUser(), makeUser(), makeUser()], noCtx);
    expect(ranked).toHaveLength(3);
  });

  it("returns an empty array for an empty candidate list", () => {
    const ranked = rankCandidates(makeUser(), [], noCtx);
    expect(ranked).toEqual([]);
  });

  it("each result's score is descending or equal", () => {
    const user = makeUser({ gyms: [gym("a")] });
    const ranked = rankCandidates(user, [
      makeUser({ gyms: [gym("a")] }),
      makeUser({ gyms: [gym("z")] }),
      makeUser({ gyms: [gym("a")] }),
    ], noCtx);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });
});

// Tests for gymsInRange function (filtering and sorting gyms by distance)
describe("gymsInRange", () => {
  // A user home gym near Bishan (~1.3553, 103.8509)
  const userGyms = [geoGym("home", "Anytime Fitness", 1.3553, 103.8509)];

  it("returns ActiveSG gyms within the radius, nearest first", () => {
    const all = [
      geoGym("near",  "ActiveSG", 1.3600, 103.8550),  // ~0.6 km away
      geoGym("mid",   "ActiveSG", 1.3900, 103.8850),  // ~5 km away
      geoGym("far",   "ActiveSG", 1.5000, 104.0000),  // way out of range
    ];
    const result = gymsInRange(userGyms, all, 10);
    expect(result.map((g) => g.id)).toEqual(["near", "mid"]); // far excluded, sorted
  });

  it("excludes non-ActiveSG gyms even if in range", () => {
    const all = [geoGym("other", "Fitness First", 1.3560, 103.8510)]; // very close
    expect(gymsInRange(userGyms, all, 10)).toEqual([]);
  });

  it("excludes gyms the user already belongs to", () => {
    const all = [
      geoGym("home", "ActiveSG", 1.3553, 103.8509),  // same id as a user gym
      geoGym("new",  "ActiveSG", 1.3560, 103.8510),
    ];
    const result = gymsInRange(userGyms, all, 10);
    expect(result.map((g) => g.id)).toEqual(["new"]); // 'home' excluded
  });

  it("returns empty when the user has no home gyms (no anchor to measure from)", () => {
    const all = [geoGym("near", "ActiveSG", 1.3560, 103.8510)];
    expect(gymsInRange([], all, 10)).toEqual([]);
  });

  it("skips gyms missing coordinates", () => {
    const all = [{ id: "nocoord", name: "X", chain: "ActiveSG", latitude: null, longitude: null }];
    expect(gymsInRange(userGyms, all, 10)).toEqual([]);
  });
});

// Tests for scoreSharedGym with ActiveSG fallback
describe("scoreSharedGym (with ActiveSG fallback)", () => {
  const noCtx = { activeSgGyms: [], radiusKm: 10 };

  it("returns 1 when they share a home gym (regardless of ActiveSG)", () => {
    const user = makeUser({ gyms: [gym("a")] });
    const candidate = makeUser({ gyms: [gym("a")] });
    expect(scoreSharedGym(user, candidate, noCtx).score).toBe(1);
  });

  it("returns 0 when no shared gym and no ActiveSG gyms available", () => {
    const user = makeUser({ gyms: [gym("a")] });
    const candidate = makeUser({ gyms: [gym("b")] });
    expect(scoreSharedGym(user, candidate, noCtx).score).toBe(0);
  });

  it("scores ActiveSG proximity when no shared home gym (closer = higher)", () => {
    // user home near (1.35, 103.85), candidate home near (1.36, 103.86)
    const user = makeUser({ gyms: [geoGym("uhome", "Anytime Fitness", 1.35, 103.85)] });
    const candidate = makeUser({ gyms: [geoGym("chome", "Fitness First", 1.36, 103.86)] });

    const ctx = {
      radiusKm: 10,
      activeSgGyms: [geoGym("asg-near", "ActiveSG", 1.355, 103.855)], // between them
    };

    const score = scoreSharedGym(user, candidate, ctx).score;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(0.75); // capped below a real shared gym
  });

  it("returns 0 when the only common ActiveSG is beyond the radius", () => {
    const user = makeUser({ gyms: [geoGym("uhome", "Anytime Fitness", 1.35, 103.85)] });
    const candidate = makeUser({ gyms: [geoGym("chome", "Fitness First", 1.36, 103.86)] });
    const ctx = {
      radiusKm: 1, // tight radius
      activeSgGyms: [geoGym("asg-far", "ActiveSG", 1.50, 104.00)], // way out
    };
    expect(scoreSharedGym(user, candidate, ctx).score).toBe(0);
  });

  it("a closer common ActiveSG scores higher than a farther one", () => {
    const user = makeUser({ gyms: [geoGym("uhome", "Anytime Fitness", 1.35, 103.85)] });
    const candidate = makeUser({ gyms: [geoGym("chome", "Fitness First", 1.36, 103.86)] });

    const near = scoreSharedGym(user, candidate, {
      radiusKm: 20,
      activeSgGyms: [geoGym("close", "ActiveSG", 1.355, 103.855)],
    });
    const far = scoreSharedGym(user, candidate, {
      radiusKm: 20,
      activeSgGyms: [geoGym("farish", "ActiveSG", 1.40, 103.90)],
    });
    expect(near.score).toBeGreaterThan(far.score);
  });

  it("reports the shared ActiveSG gym name when proximity matches", () => {
  const user = makeUser({ gyms: [geoGym("uhome", "Anytime Fitness", 1.35, 103.85)] });
  const candidate = makeUser({ gyms: [geoGym("chome", "Fitness First", 1.36, 103.86)] });
  const result = scoreSharedGym(user, candidate, {
    radiusKm: 10,
    activeSgGyms: [geoGym("Sengkang ActiveSG", "ActiveSG", 1.355, 103.855)],
  });
  expect(result.sharedActiveSg).toBe("Sengkang ActiveSG");
  });
});