import { describe, it, expect } from "vitest";
import {
  buildExerciseSeries,
  estimateOneRepMax,
  linearRegression,
  detectPlateau,
} from "./analytics";
import type { WorkoutSession } from "./supabase/workouts";

/**
 * Test helper: build a WorkoutSession with minimal boilerplate. Only the
 * fields buildExerciseSeries reads (performed_on, exercises) matter; the
 * rest are filled with throwaway values to satisfy the type.
 */
function session(
  performed_on: string,
  exercises: {
    exercise_index: number;
    exercise_name: string;
    sets: { reps: number; weight_kg: number }[];
  }[],
): WorkoutSession {
  return {
    id: `sess-${performed_on}-${Math.random()}`,
    performed_on,
    notes: null,
    created_at: `${performed_on}T00:00:00Z`,
    exercises: exercises.map((e) => ({
      exercise_index: e.exercise_index,
      exercise_name: e.exercise_name,
      sets: e.sets.map((s, i) => ({
        id: `set-${i}`,
        exercise_name: e.exercise_name,
        exercise_index: e.exercise_index,
        set_index: i + 1,
        reps: s.reps,
        weight_kg: s.weight_kg,
      })),
    })),
  };
}

describe("buildExerciseSeries", () => {
  it("returns an empty array for no sessions", () => {
    expect(buildExerciseSeries([])).toEqual([]);
  });

  it("computes the three metrics for a single exercise on one day", () => {
    // One session: Bench Press, two sets - 100kg x1 and 80kg x5.
    // bestOneRepMax: max(epley(100,1)=100, epley(80,5)=80*(1+5/30)=93.33) = 100
    // topWeight: max(100, 80) = 100
    // totalVolume: 1*100 + 5*80 = 100 + 400 = 500
    const result = buildExerciseSeries([
      session("2026-07-01", [
        {
          exercise_index: 1,
          exercise_name: "Bench Press",
          sets: [
            { reps: 1, weight_kg: 100 },
            { reps: 5, weight_kg: 80 },
          ],
        },
      ]),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].exerciseName).toBe("Bench Press");
    expect(result[0].points).toHaveLength(1);

    const point = result[0].points[0];
    expect(point.date).toBe("2026-07-01");
    expect(point.bestOneRepMax).toBeCloseTo(100, 5);
    expect(point.topWeight).toBe(100);
    expect(point.totalVolume).toBe(500);
  });

  it("returns points oldest-first even when sessions are newest-first", () => {
    // getWorkoutSessions returns newest-first; series points must be oldest-first.
    const result = buildExerciseSeries([
      session("2026-07-10", [
        { exercise_index: 1, exercise_name: "Squat", sets: [{ reps: 5, weight_kg: 100 }] },
      ]),
      session("2026-07-01", [
        { exercise_index: 1, exercise_name: "Squat", sets: [{ reps: 5, weight_kg: 90 }] },
      ]),
    ]);

    expect(result).toHaveLength(1);
    const dates = result[0].points.map((p) => p.date);
    expect(dates).toEqual(["2026-07-01", "2026-07-10"]);
  });

  it("keeps distinct exercise names as separate series", () => {
    const result = buildExerciseSeries([
      session("2026-07-01", [
        { exercise_index: 1, exercise_name: "Bench Press", sets: [{ reps: 5, weight_kg: 80 }] },
        { exercise_index: 2, exercise_name: "Squat", sets: [{ reps: 5, weight_kg: 100 }] },
      ]),
    ]);

    const names = result.map((s) => s.exerciseName).sort();
    expect(names).toEqual(["Bench Press", "Squat"]);
  });

  it("merges the same exercise logged as two blocks in one session", () => {
    // Same-name merge fix keeps these as two blocks (index 1 and 2), but for
    // a trend they're one exercise on one day: sets pool together.
    // topWeight: max(80, 90) = 90; totalVolume: 5*80 + 3*90 = 400 + 270 = 670
    const result = buildExerciseSeries([
      session("2026-07-01", [
        { exercise_index: 1, exercise_name: "Bench Press", sets: [{ reps: 5, weight_kg: 80 }] },
        { exercise_index: 2, exercise_name: "Bench Press", sets: [{ reps: 3, weight_kg: 90 }] },
      ]),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].points).toHaveLength(1);
    expect(result[0].points[0].topWeight).toBe(90);
    expect(result[0].points[0].totalVolume).toBe(670);
  });

  it("pools sets from two separate sessions on the same day into one point", () => {
    // Two sessions, same date, same exercise -> one point, not two.
    // totalVolume: 5*80 + 5*85 = 400 + 425 = 825
    const result = buildExerciseSeries([
      session("2026-07-01", [
        { exercise_index: 1, exercise_name: "Deadlift", sets: [{ reps: 5, weight_kg: 80 }] },
      ]),
      session("2026-07-01", [
        { exercise_index: 1, exercise_name: "Deadlift", sets: [{ reps: 5, weight_kg: 85 }] },
      ]),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].points).toHaveLength(1);
    expect(result[0].points[0].totalVolume).toBe(825);
    expect(result[0].points[0].topWeight).toBe(85);
  });

  it("treats similar-but-different names as distinct series (naming variance)", () => {
    const result = buildExerciseSeries([
      session("2026-07-01", [
        { exercise_index: 1, exercise_name: "Bench Press", sets: [{ reps: 5, weight_kg: 80 }] },
        { exercise_index: 2, exercise_name: "Barbell Bench Press", sets: [{ reps: 5, weight_kg: 80 }] },
      ]),
    ]);

    expect(result).toHaveLength(2);
  });

  it("handles bodyweight (zero-weight) sets without error", () => {
    // Pull-ups at 0kg: est-1RM 0, topWeight 0, volume 0. Still a valid point.
    const result = buildExerciseSeries([
      session("2026-07-01", [
        { exercise_index: 1, exercise_name: "Pull Up", sets: [{ reps: 10, weight_kg: 0 }] },
      ]),
    ]);

    expect(result[0].points[0].bestOneRepMax).toBe(0);
    expect(result[0].points[0].topWeight).toBe(0);
    expect(result[0].points[0].totalVolume).toBe(0);
  });
});

describe("estimateOneRepMax", () => {
  it("returns the weight unchanged for a single rep", () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
  });

  it("returns the weight unchanged for zero reps (guard)", () => {
    expect(estimateOneRepMax(100, 0)).toBe(100);
  });

  it("applies Epley for multi-rep sets", () => {
    // 80kg x5 -> 80 * (1 + 5/30) = 93.333...
    expect(estimateOneRepMax(80, 5)).toBeCloseTo(93.3333, 3);
  });

  it("scales with reps (10 reps at 100kg)", () => {
    // 100 * (1 + 10/30) = 133.333...
    expect(estimateOneRepMax(100, 10)).toBeCloseTo(133.3333, 3);
  });
});

describe("linearRegression", () => {
  it("returns null below the minimum point count", () => {
    expect(linearRegression([{ x: 0, y: 1 }, { x: 1, y: 2 }])).toBeNull();
  });

  it("recovers slope and intercept of a perfect line", () => {
    // y = 2x + 10
    const line = linearRegression([
      { x: 0, y: 10 },
      { x: 1, y: 12 },
      { x: 2, y: 14 },
    ]);
    expect(line).not.toBeNull();
    expect(line!.slope).toBeCloseTo(2, 6);
    expect(line!.intercept).toBeCloseTo(10, 6);
  });

  it("returns null when all x values are identical (divide-by-zero guard)", () => {
    expect(
      linearRegression([{ x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }]),
    ).toBeNull();
  });

  it("fits a best-fit line through noisy points", () => {
    // (0,1)(1,3)(2,2)(3,5)(4,4) -> least-squares slope 0.8, intercept 1.4
    const line = linearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 2 },
      { x: 3, y: 5 },
      { x: 4, y: 4 },
    ]);
    expect(line!.slope).toBeCloseTo(0.8, 6);
    expect(line!.intercept).toBeCloseTo(1.4, 6);
  });
});

describe("detectPlateau", () => {
  it("reports insufficient_data below two full windows", () => {
    expect(detectPlateau([1, 2, 3, 4, 5])).toBe("insufficient_data");
  });

  it("detects improvement above the threshold", () => {
    // prior avg 100, recent avg 110 -> +10% > 2%
    expect(detectPlateau([100, 100, 100, 110, 110, 110])).toBe("improving");
  });

  it("detects a plateau below the threshold", () => {
    // prior avg 100, recent avg ~100.33 -> +0.33% < 2%
    expect(detectPlateau([100, 100, 100, 100, 101, 100])).toBe("plateau");
  });

  it("treats positive progress from a zero baseline as improving", () => {
    expect(detectPlateau([0, 0, 0, 50, 50, 50])).toBe("improving");
  });

  it("respects a custom window size", () => {
    expect(detectPlateau([100, 100, 120, 120], 2)).toBe("improving");
  });
});