import type { WorkoutSession } from "./supabase/workouts";

/**
 * One day's summary for a single exercise. All three metrics are computed for
 * every point (the chart shows est-1RM; top weight and volume ride along for
 * the stat tiles and a possible metric toggle later).
 */
export type ExerciseDayPoint = {
  date: string;          // ISO date "YYYY-MM-DD" (from session.performed_on)
  bestOneRepMax: number; // max estimated 1RM across all sets that day
  topWeight: number;     // heaviest single set that day (kg)
  totalVolume: number;   // sum of reps * weight across all sets that day
};

/**
 * A single exercise's full history: its name and its per-day points,
 * ordered oldest-first.
 */
export type ExerciseSeries = {
  exerciseName: string;
  points: ExerciseDayPoint[];
};

/**
 * Minimal Epley 1RM used only for shaping in Phase 0. Phase 1a promotes this
 * to a estimateOneRepMax and this file imports that instead (one-line swap). 
 * reps === 1 returns the weight unchanged (a single rep IS the 1RM; Epley would otherwise inflate it by ~3%).
 */
function epley(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

/**
 * Reshapes a user's sessions into per-exercise time series for analytics.
 *
 * Input: WorkoutSession[] exactly as getWorkoutSessions returns (newest-first,
 * each session's sets grouped into exercises by (exercise_index, exercise_name)).
 *
 * Output: one ExerciseSeries per DISTINCT exercise_name, each a list of
 * per-day points (oldest-first). Two things are deliberately collapsed here:
 *   - exercise_index is ignored for grouping - "Bench Press" block 1 and
 *     block 2 in the same session are the same exercise for trend purposes.
 *   - multiple sessions on the same calendar day for the same exercise merge
 *     into one point (their sets pool before computing the day's metrics).
 *
 * Naming variance is surfaced, not solved: "Bench Press" vs "Barbell Bench
 * Press" are distinct series (distinct name strings). Names arrive Start-Case
 * normalised, so casing alone won't split a series.
 *
 * Pure: no DB, no side effects, fully unit-testable.
 */
export function buildExerciseSeries(
  sessions: WorkoutSession[],
): ExerciseSeries[] {
  // exerciseName -> (date -> accumulating day point).
  // Nested map: outer keys distinct exercises, inner keys distinct days.
  const byExercise = new Map<string, Map<string, ExerciseDayPoint>>();

  for (const session of sessions) {
    const date = session.performed_on;

    for (const exercise of session.exercises) {
      const name = exercise.exercise_name;

      // Ensure a day-map exists for this exercise.
      const dayMap =
        byExercise.get(name) ?? new Map<string, ExerciseDayPoint>();
      byExercise.set(name, dayMap);

      // Start from any existing point for this exercise on this day, so
      // sets from a second same-day session pool into the same point.
      const existing = dayMap.get(date);
      let bestOneRepMax = existing?.bestOneRepMax ?? 0;
      let topWeight = existing?.topWeight ?? 0;
      let totalVolume = existing?.totalVolume ?? 0;

      for (const set of exercise.sets) {
        const orm = epley(set.weight_kg, set.reps);
        if (orm > bestOneRepMax) bestOneRepMax = orm;
        if (set.weight_kg > topWeight) topWeight = set.weight_kg;
        totalVolume += set.reps * set.weight_kg;
      }

      dayMap.set(date, { date, bestOneRepMax, topWeight, totalVolume });
    }
  }

  // Flatten: each exercise's day-map -> points array, sorted oldest-first.
  const series: ExerciseSeries[] = [];
  for (const [exerciseName, dayMap] of byExercise) {
    const points = Array.from(dayMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    series.push({ exerciseName, points });
  }

  return series;
}