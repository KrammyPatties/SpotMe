import { describe, it, expect } from "vitest";
import { prepareAnalytics, PROJECTION_CAP_DAYS } from "./analytics-prep";
import type { WorkoutSession } from "./supabase/workouts";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Build a WorkoutSession with one exercise of one set at the given weight×5.
 * bestOneRepMax for a 5-rep set = weight * (1 + 5/30). We invert that in the
 * assertions by passing weights whose 1RM is easy to reason about, but for the
 * prep tests we mostly care about SHAPE (rows, projection, tiles), so a single
 * clean set per day keeps arithmetic simple.
 */
function daySession(date: string, exercise: string, weight: number): WorkoutSession {
  return {
    id: `s-${date}-${Math.random()}`,
    performed_on: date,
    notes: null,
    created_at: `${date}T00:00:00Z`,
    exercises: [
      {
        exercise_index: 1,
        exercise_name: exercise,
        sets: [
          {
            id: `set-${date}`,
            exercise_name: exercise,
            exercise_index: 1,
            set_index: 1,
            reps: 1, // 1 rep -> est-1RM == weight, so numbers stay clean
            weight_kg: weight,
          },
        ],
      },
    ],
  };
}

describe("prepareAnalytics", () => {
  it("returns [] for no sessions", () => {
    expect(prepareAnalytics([])).toEqual([]);
  });

  it("produces a projection and stat tiles for a 3-point series", () => {
    const result = prepareAnalytics([
      daySession("2026-07-01", "Bench Press", 100),
      daySession("2026-07-08", "Bench Press", 105),
      daySession("2026-07-15", "Bench Press", 110),
    ]);

    expect(result).toHaveLength(1);
    const a = result[0];
    expect(a.exerciseName).toBe("Bench Press");
    expect(a.hasProjection).toBe(true);
    expect(a.pointCount).toBe(3);
    expect(a.currentOneRepMax).toBe(110);
    expect(a.changeOverPeriod).toBe(10);
  });

  it("labels actual rows DD/MM and connects the seam", () => {
    const a = prepareAnalytics([
      daySession("2026-07-01", "Bench Press", 100),
      daySession("2026-07-08", "Bench Press", 105),
      daySession("2026-07-15", "Bench Press", 110),
    ])[0];

    expect(a.rows[0].label).toBe("01/07");
    // 3 actual points; the last one also seeds the projected line (seam).
    expect(a.rows[2].actual).toBe(110);
    expect(a.rows[2].projected).toBe(110);
    // Projected rows appended after the actuals, with null actual.
    expect(a.rows.length).toBeGreaterThan(3);
    expect(a.rows[3].actual).toBeNull();
    expect(a.rows[3].projected).not.toBeNull();
  });

  it("does not project below three points but still computes tiles", () => {
    const a = prepareAnalytics([
      daySession("2026-07-01", "Squat", 100),
      daySession("2026-07-08", "Squat", 105),
    ])[0];

    expect(a.hasProjection).toBe(false);
    expect(a.rows.every((r) => r.projected === null)).toBe(true);
    expect(a.changeOverPeriod).toBe(5);
    expect(a.status).toBe("insufficient_data");
  });

  it("handles a single-point series (no change, no projection)", () => {
    const a = prepareAnalytics([daySession("2026-07-01", "Deadlift", 120)])[0];

    expect(a.currentOneRepMax).toBe(120);
    expect(a.changeOverPeriod).toBeNull();
    expect(a.hasProjection).toBe(false);
    expect(a.pointCount).toBe(1);
  });

  it("caps the projection at PROJECTION_CAP_DAYS for a long history", () => {
    const a = prepareAnalytics([
      daySession("2026-01-01", "OHP", 50),
      daySession("2026-04-01", "OHP", 60),
      daySession("2026-07-20", "OHP", 70),
    ])[0];

    const lastActualT = new Date("2026-07-20T00:00:00Z").getTime();
    const lastRowT = a.rows[a.rows.length - 1].t;
    const daysProjected = Math.round((lastRowT - lastActualT) / MS_PER_DAY);
    expect(daysProjected).toBe(PROJECTION_CAP_DAYS);
  });

  it("sorts exercises most-data-first", () => {
    const result = prepareAnalytics([
      daySession("2026-07-01", "Squat", 100),
      daySession("2026-07-01", "Bench Press", 80),
      daySession("2026-07-08", "Bench Press", 82),
      daySession("2026-07-15", "Bench Press", 84),
    ]);

    // Bench Press has 3 points, Squat has 1 -> Bench Press first.
    expect(result[0].exerciseName).toBe("Bench Press");
    expect(result[0].pointCount).toBe(3);
    expect(result[1].exerciseName).toBe("Squat");
  });
});