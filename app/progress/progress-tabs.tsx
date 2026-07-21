"use client";

// The Progress page's two-tab shell: "Log" (log form + history, passed in as
// children from the server page) and "Progress" (the analytics section). Mirrors
// the Discover/Requests tab pattern in match-feed.tsx - hand-rolled useState, the
// same flame-underline active style - for consistency across the app.

import { useState } from "react";
import { ProgressAnalytics } from "./progress-analytics";
import type { ExerciseAnalytics } from "@/lib/analytics-prep";

export function ProgressTabs({
  analytics,
  children,
}: {
  analytics: ExerciseAnalytics[];
  children: React.ReactNode; // the Log tab's content (server-rendered)
}) {
  const [tab, setTab] = useState<"log" | "progress">("log");

  return (
    <div>
      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-ink/15">
        <button
          type="button"
          onClick={() => setTab("log")}
          className={`px-4 py-2 text-sm font-medium ${
            tab === "log"
              ? "border-b-2 border-flame text-flame"
              : "text-ink/60"
          }`}
        >
          Log
        </button>
        <button
          type="button"
          onClick={() => setTab("progress")}
          className={`px-4 py-2 text-sm font-medium ${
            tab === "progress"
              ? "border-b-2 border-flame text-flame"
              : "text-ink/60"
          }`}
        >
          Progress
        </button>
      </div>

      {/* Both tabs stay mounted; only the active one is shown. Keeping the Log
          tab mounted preserves any in-progress form state when switching tabs. */}
      <div className={tab === "log" ? "" : "hidden"}>{children}</div>
      <div className={tab === "progress" ? "" : "hidden"}>
        <ProgressAnalytics exercises={analytics} />
      </div>
    </div>
  );
}