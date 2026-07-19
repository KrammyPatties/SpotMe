"use client";

// The Progress-tab analytics section. Owns the exercise dropdown selection and
// renders the status pill, chart, projection disclaimer, and stat tiles for the
// chosen exercise. All heavy computation (series, projection, plateau) is done
// server-side and passed in via `exercises` — this component only picks which
// pre-computed bundle to display, so switching exercises is instant.

import { useState } from "react";
import { ExerciseChart, type ChartRow } from "./exercise-chart";
import type { PlateauStatus } from "@/lib/analytics";

/** One exercise's fully-prepared analytics, computed server-side. */
export type ExerciseAnalytics = {
  exerciseName: string;
  rows: ChartRow[]; // actuals + projection merged, DD/MM labels
  hasProjection: boolean; // false when < 3 points (projection gate)
  status: PlateauStatus;
  pointCount: number; // distinct logged days
  currentOneRepMax: number | null; // latest actual est-1RM
  changeOverPeriod: number | null; // latest - earliest actual est-1RM
};

const STATUS_PILL: Record<
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
  insufficient_data: {
    text: "Keep logging to see trends",
    className: "bg-ink/10 text-ink/50",
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
  const pill = STATUS_PILL[selected.status];

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

      {/* Chart */}
      <div className="rounded-lg border border-ink/10 bg-white/60 p-4">
        <ExerciseChart rows={selected.rows} hasProjection={selected.hasProjection} />

        {/* Legend + disclaimer, only when a projection is drawn */}
        {selected.hasProjection && (
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
          label="Current est. 1RM"
          value={
            selected.currentOneRepMax != null
              ? `${Math.round(selected.currentOneRepMax)} kg`
              : "—"
          }
        />
        <StatTile
          label="Change"
          value={
            selected.changeOverPeriod != null
              ? `${selected.changeOverPeriod >= 0 ? "+" : ""}${Math.round(
                  selected.changeOverPeriod,
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