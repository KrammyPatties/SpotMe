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
    expect(a.byMetric.bestOneRepMax.hasProjection).toBe(true);
    expect(a.pointCount).toBe(3);
    expect(a.byMetric.bestOneRepMax.currentValue).toBe(110);
    expect(a.byMetric.bestOneRepMax.changeOverPeriod).toBe(10);
  });

  it("connects the actual and projected lines at the seam", () => {
    const v = prepareAnalytics([
      daySession("2026-07-01", "Bench Press", 100),
      daySession("2026-07-08", "Bench Press", 105),
      daySession("2026-07-15", "Bench Press", 110),
    ])[0].byMetric.bestOneRepMax;

    // 3 actual points; the last one also seeds the projected line (seam).
    expect(v.rows[2].actual).toBe(110);
    expect(v.rows[2].projected).toBe(110);
    // Projected rows appended after the actuals, with null actual.
    expect(v.rows.length).toBeGreaterThan(3);
    expect(v.rows[3].actual).toBeNull();
    expect(v.rows[3].projected).not.toBeNull();
  });

  it("does not project below three points but still computes tiles", () => {
    const v = prepareAnalytics([
      daySession("2026-07-01", "Squat", 100),
      daySession("2026-07-08", "Squat", 105),
    ])[0].byMetric.bestOneRepMax;

    expect(v.hasProjection).toBe(false);
    expect(v.rows.every((r) => r.projected === null)).toBe(true);
    expect(v.changeOverPeriod).toBe(5);
    expect(v.status).toBe("insufficient_data");
  });

  it("handles a single-point series (no change, no projection)", () => {
    const a = prepareAnalytics([daySession("2026-07-01", "Deadlift", 120)])[0];

    expect(a.byMetric.bestOneRepMax.currentValue).toBe(120);
    expect(a.byMetric.bestOneRepMax.changeOverPeriod).toBeNull();
    expect(a.byMetric.bestOneRepMax.hasProjection).toBe(false);
    expect(a.pointCount).toBe(1);
  });

  it("caps the projection at PROJECTION_CAP_DAYS for a long history", () => {
    const a = prepareAnalytics([
      daySession("2026-01-01", "OHP", 50),
      daySession("2026-04-01", "OHP", 60),
      daySession("2026-07-20", "OHP", 70),
    ])[0];

    const lastActualT = new Date("2026-07-20T00:00:00Z").getTime();
    const rows = a.byMetric.bestOneRepMax.rows;
    const lastRowT = rows[rows.length - 1].t;
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

  it("prepares all three metrics with distinct values", () => {
    // reps: 1 makes all three metrics coincide, so bump it: at 5 reps,
    // est-1RM = 100 * (1 + 5/30), topWeight = 100, volume = 5 * 100.
    const session = daySession("2026-07-01", "Row", 100);
    session.exercises[0].sets[0].reps = 5;

    const a = prepareAnalytics([session])[0];

    expect(a.byMetric.bestOneRepMax.currentValue).toBeCloseTo(
      100 * (1 + 5 / 30),
    );
    expect(a.byMetric.topWeight.currentValue).toBe(100);
    expect(a.byMetric.totalVolume.currentValue).toBe(500);
  });

  it("projects independently on every metric", () => {
    const a = prepareAnalytics([
      daySession("2026-07-01", "Bench Press", 100),
      daySession("2026-07-08", "Bench Press", 105),
      daySession("2026-07-15", "Bench Press", 110),
    ])[0];

    for (const m of ["bestOneRepMax", "topWeight", "totalVolume"] as const) {
      expect(a.byMetric[m].hasProjection).toBe(true);
      expect(a.byMetric[m].rows.length).toBeGreaterThan(3);
    }
  });

});