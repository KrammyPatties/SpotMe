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
        const orm = estimateOneRepMax(set.weight_kg, set.reps);
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

/**
 * Estimated one-rep max via the Epley formula: weight * (1 + reps/30).
 *
 * The canonical version (Phase 0's private `epley` is removed and this is
 * used everywhere instead). reps <= 1 returns the weight unchanged — a single
 * rep already IS a 1RM, and Epley would otherwise inflate it by ~3%.
 *
 * Epley is chosen over Brzycki for one honest reason: Brzycki's denominator
 * (37 - reps) collapses toward zero near 37 reps, producing absurd estimates,
 * while Epley degrades gracefully. Estimates above ~12 reps are unreliable for
 * BOTH formulas (the linear rep-strength assumption breaks down); callers that
 * care should flag high-rep sets rather than trust the number.
 */
export function estimateOneRepMax(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

/** A fitted straight line: value = slope * x + intercept, where x is the
 *  day-offset from the first point. `null` means "not enough data to fit." */
export type TrendLine = { slope: number; intercept: number };

/**
 * Least-squares linear regression over (x, y) points, where x is days-since
 * the first point and y is the metric value (est-1RM by default).
 *
 * Returns null below MIN_POINTS_FOR_TREND (3) — a product decision, not a
 * math one: a line only needs 2 points, but projecting a strength trend off
 * two data points is noise, so we refuse. Also returns null if every x is
 * identical (all points same day) — the slope would divide by zero.
 *
 * Pure; consumed by the projection step and by Phase 1b's swappable fit.
 */
export const MIN_POINTS_FOR_TREND = 3;

export function linearRegression(
  points: { x: number; y: number }[],
): TrendLine | null {
  const n = points.length;
  if (n < MIN_POINTS_FOR_TREND) return null;

  const sumX = points.reduce((acc, p) => acc + p.x, 0);
  const sumY = points.reduce((acc, p) => acc + p.y, 0);
  const sumXY = points.reduce((acc, p) => acc + p.x * p.y, 0);
  const sumXX = points.reduce((acc, p) => acc + p.x * p.x, 0);

  // Denominator of the least-squares slope. Zero when all x are equal
  // (e.g. every point on the same day) - undefined slope, so bail.
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

/** Plateau status for the UI's status pill. Three distinct states so a
 *  new user ("insufficient_data") is never mislabelled as plateaued. */
export type PlateauStatus = "improving" | "plateau" | "insufficient_data";

/**
 * Detects a strength plateau by comparing two rolling windows: the average of
 * the most-recent `window` points against the average of the `window` points
 * before them. If recent hasn't improved on prior by more than `threshold`
 * (fractional, e.g. 0.02 = 2%), it's a plateau.
 *
 * Needs at least 2*window points to fill both windows; fewer -> insufficient.
 * Values are the metric being tracked (est-1RM per day), oldest-first.
 */
export function detectPlateau(
  values: number[],
  window = 3,
  threshold = 0.02,
): PlateauStatus {
  if (values.length < window * 2) return "insufficient_data";

  const recent = values.slice(-window);
  const prior = values.slice(-window * 2, -window);

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);

  // Guard: if prior averaged zero (all-bodyweight history), any positive
  // recent average is improvement; otherwise it's flat.
  if (priorAvg === 0) return recentAvg > 0 ? "improving" : "plateau";

  const relativeGain = (recentAvg - priorAvg) / priorAvg;
  return relativeGain > threshold ? "improving" : "plateau";
}