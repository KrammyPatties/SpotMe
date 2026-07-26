"use client";

// Full session history, split into three tabs. Read-only by design: every
// action (propose, confirm, cancel) stays in the chatroom panel, so there is
// exactly one place each action lives and no duplicated fetch handlers.
//
// Tab membership is derived, never stored. A completed session sits in your
// "To rate" and your partner's "Completed" at the same time — the same
// per-viewer derivation the rating prompt uses.

import { useState } from "react";
import type { ChatroomSession } from "@/lib/supabase/sessions";
import { formatSlot } from "../session-panel";

type Tab = "upcoming" | "toRate" | "completed";

type Props = {
  chatroomId: string;
  sessions: ChatroomSession[];
  /** Session ids this viewer still owes a rating for. Array, not Set — plain
   *  arrays are the safest thing to hand across the server/client boundary. */
  pendingRatingIds: string[];
};

const TABS: { key: Tab; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "toRate", label: "To rate" },
  { key: "completed", label: "Completed" },
];

export default function SessionLog({
  chatroomId,
  sessions,
  pendingRatingIds,
}: Props) {
  const [tab, setTab] = useState<Tab>("upcoming");
  const pending = new Set(pendingRatingIds);

  const upcoming = sessions.filter(
    (s) => s.status === "proposed" || s.status === "confirmed"
  );
  const toRate = sessions.filter(
    (s) => s.status === "completed" && pending.has(s.id)
  );
  const completed = sessions.filter(
    (s) => s.status === "completed" && !pending.has(s.id)
  );

  const shown =
    tab === "upcoming" ? upcoming : tab === "toRate" ? toRate : completed;

  const counts: Record<Tab, number> = {
    upcoming: upcoming.length,
    toRate: toRate.length,
    completed: completed.length,
  };

  const emptyText: Record<Tab, string> = {
    upcoming: "Nothing scheduled. Propose a time from the chat.",
    toRate: "No sessions waiting on your rating.",
    completed: "No completed sessions yet.",
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex gap-2 border-b border-ink/15 px-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-b-2 border-flame text-flame"
                : "text-ink/60"
            }`}
          >
            {t.label}
            {counts[t.key] > 0 && ` (${counts[t.key]})`}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-ink/60">
          {emptyText[tab]}
        </p>
      ) : (
        <ul className="space-y-2 p-4">
          {shown.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-ink/15 bg-white px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {formatSlot(s.starts_at, s.ends_at)}
                  </p>
                  <p className="truncate text-xs text-ink/60">
                    {s.gym_name ?? "Location TBC"}
                    {s.status === "proposed" && ` · proposed by ${s.proposer_name}`}
                  </p>
                </div>

                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                  style={{
                    backgroundColor:
                      s.status === "confirmed"
                        ? "#14b8a6"
                        : s.status === "completed"
                          ? "#111111"
                          : "#f95311",
                    color: "#ffffff",
                  }}
                >
                  {s.status}
                </span>
              </div>

              {s.status === "confirmed" && (
                <a
                  href={`/api/sessions/${s.id}/ics`}
                  className="mt-2 inline-block rounded-full border border-ink/25 px-3 py-1 text-xs font-semibold text-ink"
                >
                  Add to calendar
                </a>
              )}

              {tab === "toRate" && (
                <a
                  href={`/messages/${chatroomId}/rate/${s.id}`}
                  className="mt-2 inline-block rounded-full bg-flame px-3 py-1 text-xs font-semibold text-white"
                >
                  Rate
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
