import {
  buildExerciseSeries,
  projectForward,
  detectPlateau,
  type ExerciseSeries,
} from "./analytics";

// Presentation-prep layer: turns raw sessions into the ExerciseAnalytics[] the
// Progress-tab components consume. Separate from analytics.ts (pure math) because
// this layer knows about chart concerns - ChartRow shape, DD/MM labels, the
// actuals+projection merge, stat-tile numbers. Pure and testable; runs
// server-side so no analytics code ships to the browser.

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Never project more than this far past the last logged day, even if the user
 *  has a longer history. Keeps the chart readable and the extrapolation honest. */
export const PROJECTION_CAP_DAYS = 30;

/** One chart x-axis row. Mirrors ChartRow in exercise-chart.tsx (kept in sync
 *  by hand - this is the server-side producer, that's the client consumer). */
export type ChartRow = {
  t: number;
  label: string;
  actual: number | null;
  projected: number | null;
};

/** The per-exercise bundle the Progress tab renders. Mirrors ExerciseAnalytics
 *  in progress-analytics.tsx. */
export type ExerciseAnalytics = {
  exerciseName: string;
  rows: ChartRow[];
  hasProjection: boolean;
  status: ReturnType<typeof detectPlateau>;
  pointCount: number;
  currentOneRepMax: number | null;
  changeOverPeriod: number | null;
};

/** Format a UTC timestamp as "DD/MM". UTC throughout so a day never shifts. */
function formatDDMM(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

/**
 * Prepares one exercise's series into its chart-ready analytics bundle:
 * span-matched (capped) projection, merged actual/projected rows with a
 * connecting seam, plateau status, and the three stat-tile numbers.
 */
function prepExercise(series: ExerciseSeries): ExerciseAnalytics {
  const pts = series.points;
  const t0 = pts.length
    ? new Date(pts[0].date + "T00:00:00Z").getTime()
    : 0;

  // Project as far ahead as the logged span, capped. min 1 so a valid (>=3pt)
  // series always projects at least a day.
  const spanDays =
    pts.length >= 2
      ? Math.round(
          (new Date(pts[pts.length - 1].date + "T00:00:00Z").getTime() - t0) /
            MS_PER_DAY,
        )
      : 0;
  // Project half the logged span (honest: predict less far than you've observed),
  // capped. min 1 so a valid (>=3pt) series always projects at least a day.
  const daysAhead = Math.min(Math.max(Math.round(spanDays / 2), 1), PROJECTION_CAP_DAYS);
  const projection = projectForward(series, daysAhead);

  // Actual rows.
  const rows: ChartRow[] = pts.map((p) => {
    const t = new Date(p.date + "T00:00:00Z").getTime();
    return { t, label: formatDDMM(t), actual: p.bestOneRepMax, projected: null };
  });

  // Seam + projected rows: the last actual also seeds the projected line so the
  // flame and teal lines join at that point.
  if (projection && rows.length > 0) {
    rows[rows.length - 1].projected = rows[rows.length - 1].actual;
    for (const pp of projection) {
      const t = t0 + pp.dayOffset * MS_PER_DAY;
      rows.push({ t, label: formatDDMM(t), actual: null, projected: pp.value });
    }
  }

  const status = detectPlateau(pts.map((p) => p.bestOneRepMax));
  const currentOneRepMax = pts.length
    ? pts[pts.length - 1].bestOneRepMax
    : null;
  const changeOverPeriod =
    pts.length >= 2
      ? pts[pts.length - 1].bestOneRepMax - pts[0].bestOneRepMax
      : null;

  return {
    exerciseName: series.exerciseName,
    rows,
    hasProjection: projection !== null,
    status,
    pointCount: pts.length,
    currentOneRepMax,
    changeOverPeriod,
  };
}

/**
 * Top-level: raw sessions -> per-exercise analytics, sorted most-data-first so
 * the Progress tab's dropdown defaults to the richest (most chartable) series.
 */
export function prepareAnalytics(
  sessions: Parameters<typeof buildExerciseSeries>[0],
): ExerciseAnalytics[] {
  return buildExerciseSeries(sessions)
    .map(prepExercise)
    .sort((a, b) => b.pointCount - a.pointCount);
}