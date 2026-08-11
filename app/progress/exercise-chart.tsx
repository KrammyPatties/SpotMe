"use client";

// Pure presentation: given one exercise's chart rows (actuals + optional
// projection, already merged and formatted server-side / by the wrapper), draws
// the line chart. No analytics logic here - props in, chart out. "use client"
// is mandatory: Recharts uses browser APIs and can't server-render.

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Label,
} from "recharts";
import type { ChartRow } from "@/lib/analytics-prep";

const FLAME = "#f95311"; // actuals - logged past (matches brand)
const TEAL = "#14b8a6"; // projection - the future (complementary to flame)

/** Format a UTC timestamp as "DD/MM" for axis ticks. UTC so a day never shifts. */
function formatDDMM(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

export function ExerciseChart({
  rows,
  hasProjection,
  yAxisLabel,
}: {
  rows: ChartRow[];
  hasProjection: boolean;
  yAxisLabel: string;
}) {
  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(17,17,17,0.08)" />

          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(ms: number) => formatDDMM(ms)}
            tick={{ fontSize: 12, fill: "rgba(17,17,17,0.6)" }}
            tickMargin={8}
          >
            <Label value="Date (DD/MM)" position="bottom" offset={8}
              style={{ fontSize: 12, fill: "rgba(17,17,17,0.6)" }} />
          </XAxis>

          <YAxis
            tick={{ fontSize: 12, fill: "rgba(17,17,17,0.6)" }}
            width={64}
            domain={["auto", "auto"]}
          >
            <Label value={yAxisLabel} angle={-90} position="insideLeft"
              style={{ fontSize: 12, fill: "rgba(17,17,17,0.6)", textAnchor: "middle" }} />
          </YAxis>

          <Tooltip
            formatter={(value) => [`${Math.round(Number(value))} kg`, ""]}
            labelFormatter={(ms) => `Date: ${formatDDMM(Number(ms))}`}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid rgba(17,17,17,0.1)" }}
          />

          {/* Actuals: solid flame line, filled flame dots. connectNulls false so
              it stops at the last logged point (doesn't bridge into projection). */}
          <Line
            type="monotone"
            dataKey="actual"
            stroke={FLAME}
            strokeWidth={2}
            dot={{ r: 4, fill: FLAME, stroke: FLAME }}
            connectNulls={false}
            isAnimationActive={false}
            name="Logged"
          />

          {/* Projection: dashed teal line, hollow teal dots (white fill). Only
              rendered when a projection exists. connectNulls true so it draws
              across from the seam. */}
          {hasProjection && (
            <Line
              type="monotone"
              dataKey="projected"
              stroke={TEAL}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 4, fill: "#ffffff", stroke: TEAL, strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
              name="Projected"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}