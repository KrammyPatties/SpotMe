"use client";

// The Progress-tab analytics section. Owns two selections — which exercise and
// which metric — and renders the status pill, chart, disclaimers, and stat
// tiles for that pair. All heavy computation (series, projection, plateau) is
// done server-side for every metric and passed in via `exercises`; this
// component only picks which pre-computed bundle to display, so both switches
// are instant.

import { useState } from "react";
import { ExerciseChart } from "./exercise-chart";
import type { ExerciseAnalytics } from "@/lib/analytics-prep";
import type { PlateauStatus, TrendMetric } from "@/lib/analytics";
export type { ExerciseAnalytics };

const STATUS_PILL: Record <
  PlateauStatus,
  { text: string; className: string }
> = {
  improving: {
    text: "Trending up",
    className: "bg-flame/10 text-flame",
  },
  plateau: {
    text: "Plateau",
    className: "bg-ink/10 text-ink/60",
  },
  provisional: {
    text: "Building your trend",
    className: "bg-flame/10 text-flame/80",
  },
  insufficient_data: {
    text: "Keep logging to see trends",
    className: "bg-ink/10 text-ink/50",
  },
};

/** Display order for the toggle, plus the per-metric wording. Volume and top
 *  weight ride along in the data already — only the labels differ. */
const METRIC_ORDER: TrendMetric[] = ["bestOneRepMax", "topWeight", "totalVolume"];

const METRIC_META: Record <
  TrendMetric,
  { toggle: string; tile: string; axis: string }
> = {
  bestOneRepMax: {
    toggle: "Est. 1RM",
    tile: "Current est. 1RM",
    axis: "Est. 1RM (kg)",
  },
  topWeight: {
    toggle: "Top weight",
    tile: "Current top weight",
    axis: "Top weight (kg)",
  },
  totalVolume: {
    toggle: "Volume",
    tile: "Latest day's volume",
    axis: "Daily volume (kg)",
  },
};

export function ProgressAnalytics({
  exercises,
}: {
  exercises: ExerciseAnalytics[];
}) {
  // Default to the first exercise (Phase 4 sorts them most-data-first, so the
  // chart opens on the richest series).
  const [selectedName, setSelectedName] = useState(
    exercises[0]?.exerciseName ?? "",
  );

  const [metric, setMetric] = useState<TrendMetric>("bestOneRepMax");

  if (exercises.length === 0) {
    return (
      <p className="rounded-lg border border-ink/10 bg-white/50 p-6 text-center text-ink/60">
        No workout data yet. Log a few sessions and your progress charts will
        appear here.
      </p>
    );
  }

  const selected =
    exercises.find((e) => e.exerciseName === selectedName) ?? exercises[0];
  const view = selected.byMetric[metric];
  const meta = METRIC_META[metric];
  const pill = STATUS_PILL[view.status];

  return (
    <div className="space-y-4">
      {/* Exercise dropdown + status pill */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-ink/70">Exercise</span>
          <select
            value={selected.exerciseName}
            onChange={(e) => setSelectedName(e.target.value)}
            className="rounded border border-ink/20 bg-white px-2 py-1"
          >
            {exercises.map((e) => (
              <option key={e.exerciseName} value={e.exerciseName}>
                {e.exerciseName}
              </option>
            ))}
          </select>
        </label>

        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${pill.className}`}
        >
          {pill.text}
        </span>
      </div>

      {/* Metric toggle: same series, three lenses. All pre-computed server-side,
          so switching is a re-render with no recomputation. */}
      <div className="flex gap-1 rounded-lg border border-ink/10 bg-white/60 p-1">
        {METRIC_ORDER.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${
              m === metric
                ? "bg-flame text-white"
                : "text-ink/60 hover:text-ink"
            }`}
          >
            {METRIC_META[m].toggle}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="rounded-lg border border-ink/10 bg-white/60 p-4">
        <ExerciseChart
          rows={view.rows}
          hasProjection={view.hasProjection}
          yAxisLabel={meta.axis}
        />

        {/* Per-metric honesty notes. Est-1RM is a formula, not a measurement;
            volume moves with set count as well as load. */}
        {metric === "bestOneRepMax" && (
          <p className="mt-2 text-xs text-ink/50">
            Est. 1RM is calculated from your logged sets (Epley) and is less
            reliable above about 12 reps.
          </p>
        )}
        {metric === "totalVolume" && (
          <p className="mt-2 text-xs text-ink/50">
            Daily volume moves with set count as well as load, so its trend is
            noisier than est. 1RM.
          </p>
        )}

        {/* Legend + disclaimer, only when a projection is drawn */}
        {view.hasProjection && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-4 text-xs text-ink/60">
              <span className="flex items-center gap-1">
                <span className="inline-block h-0.5 w-4 bg-flame" /> Logged
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="inline-block h-0.5 w-4"
                  style={{ borderTop: "2px dashed #14b8a6" }}
                />{" "}
                Projected
              </span>
            </div>
            <p className="text-xs text-ink/50">
              Projections aren&apos;t exact and get more accurate the more you log.
            </p>
          </div>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label={meta.tile}
          value={
            view.currentValue != null
              ? `${Math.round(view.currentValue)} kg`
              : "—"
          }
        />
        <StatTile
          label="Change"
          value={
            view.changeOverPeriod != null
              ? `${view.changeOverPeriod >= 0 ? "+" : ""}${Math.round(
                  view.changeOverPeriod,
                )} kg`
              : "—"
          }
        />

        <StatTile
          label="Sessions"
          value={String(selected.pointCount)}
        />
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white/60 p-3 text-center">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-ink/60">{label}</p>
    </div>
  );
}