import {
  buildExerciseSeries,
  projectForward,
  detectPlateau,
  type ExerciseSeries,
  type TrendMetric,
} from "./analytics";

// Presentation-prep layer: turns raw sessions into the ExerciseAnalytics[] the
// Progress-tab components consume. Separate from analytics.ts (pure math) because
// this layer knows about chart concerns - ChartRow shape, the
// actuals+projection merge, stat-tile numbers. Pure and testable; runs
// server-side so no analytics code ships to the browser.

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Never project more than this far past the last logged day, even if the user
 *  has a longer history. Keeps the chart readable and the extrapolation honest. */
export const PROJECTION_CAP_DAYS = 30;

/** One chart row. `t` is a real UTC timestamp - the x-axis is a numeric time
 *  scale, so the chart formats its own tick labels and needs no label field. */
export type ChartRow = {
  t: number;
  actual: number | null;
  projected: number | null;
};

/** Everything that depends on WHICH metric is selected. exerciseName and
 *  pointCount don't, so they stay on ExerciseAnalytics. */
export type MetricView = {
  rows: ChartRow[];
  hasProjection: boolean;
  status: ReturnType<typeof detectPlateau>;
  currentValue: number | null;
  changeOverPeriod: number | null;
};

/** The per-exercise bundle the Progress tab renders. All three metrics are
 *  prepared eagerly server-side, so the toggle is instant and no analytics
 *  code ships to the browser. */
export type ExerciseAnalytics = {
  exerciseName: string;
  pointCount: number;
  byMetric: Record<TrendMetric, MetricView>;
};

/**
 * Prepares one exercise's series on ONE metric: span-matched (capped)
 * projection, merged actual/projected rows with a connecting seam, plateau
 * status, and the stat-tile numbers. Called once per metric by prepExercise.
 */
function prepMetric(series: ExerciseSeries, metric: TrendMetric): MetricView {
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
  const projection = projectForward(series, daysAhead, metric);

  // Actual rows.
  const rows: ChartRow[] = pts.map((p) => {
    const t = new Date(p.date + "T00:00:00Z").getTime();
    return { t, actual: p[metric], projected: null };
  });

  // Seam + projected rows: the last actual also seeds the projected line so the
  // flame and teal lines join at that point.
  if (projection && rows.length > 0) {
    rows[rows.length - 1].projected = rows[rows.length - 1].actual;
    for (const pp of projection) {
      const t = t0 + pp.dayOffset * MS_PER_DAY;
      rows.push({ t, actual: null, projected: pp.value });
    }
  }

  const status = detectPlateau(pts.map((p) => p[metric]));
  const currentValue = pts.length ? pts[pts.length - 1][metric] : null;
  const changeOverPeriod =
    pts.length >= 2 ? pts[pts.length - 1][metric] - pts[0][metric] : null;

  return {
    rows,
    hasProjection: projection !== null,
    status,
    currentValue,
    changeOverPeriod,
  };
}

/**
 * One exercise, all three metrics. Listed explicitly rather than mapped over a
 * union so the Record is exhaustive by construction — adding a TrendMetric
 * fails to compile here until it's handled.
 */
function prepExercise(series: ExerciseSeries): ExerciseAnalytics {
  return {
    exerciseName: series.exerciseName,
    pointCount: series.points.length,
    byMetric: {
      bestOneRepMax: prepMetric(series, "bestOneRepMax"),
      topWeight: prepMetric(series, "topWeight"),
      totalVolume: prepMetric(series, "totalVolume"),
    },
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