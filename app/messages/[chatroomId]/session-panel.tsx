"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatroomSession, UserGym } from "@/lib/supabase/sessions";
import { PendingRating } from "@/lib/supabase/ratings";

type Props = {
  chatroomId: string;
  currentUserId: string;
  sessions: ChatroomSession[];
  userGyms: UserGym[];
  pendingRating: PendingRating | null;
};

const DURATIONS = [
  { label: "30 min", minutes: 30 },
  { label: "45 min", minutes: 45 },
  { label: "1 hour", minutes: 60 },
  { label: "1½ hours", minutes: 90 },
  { label: "2 hours", minutes: 120 },
];

function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatSlot(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);

  const date = start.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const t = (d: Date) =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return `${date} · ${t(start)}–${t(end)}`;
}

export default function SessionPanel({
  chatroomId,
  currentUserId,
  sessions,
  userGyms,
  pendingRating,
}: Props) {
  const router = useRouter();

  const [formOpen, setFormOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  const [minutes, setMinutes] = useState(60);
  const [gymId, setGymId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePropose() {
    setError(null);

    if (!date || !time) {
      setError("Pick a date and time");
      return;
    }

    const startsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(startsAt.getTime())) {
      setError("That date and time didn't parse");
      return;
    }
    const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

    setBusy(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatroom_id: chatroomId,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          gym_id: gymId || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Couldn't propose that session");
        return;
      }

      setFormOpen(false);
      setDate("");
      setGymId("");
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  async function handleRespond(sessionId: string, action: "confirm" | "cancel") {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/sessions/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, action }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Couldn't update that session");
        return;
      }

      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-b border-ink/10 bg-cream px-4 py-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Sessions</h2>
        <button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          className="rounded-full bg-flame px-3 py-1 text-xs font-semibold text-white"
        >
          {formOpen ? "Close" : "Propose a session"}
        </button>
      </div>

      {error && (
        <p className="mt-2 rounded border border-flame/40 bg-flame/10 px-2 py-1 text-xs text-ink">
          {error}
        </p>
      )}

      {pendingRating && (
        <a
          href={`/messages/${chatroomId}/rate/${pendingRating.sessionId}`}
          className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-flame/40 px-3 py-2"
          style={{ backgroundColor: "rgba(249, 83, 17, 0.08)" }}
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">
              Rate your session
            </span>
            <span className="block truncate text-xs text-ink/60">
              with {pendingRating.pendingMembers.map((m) => m.displayName).join(", ")}
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-flame px-3 py-1 text-xs font-semibold text-white">
            Rate
          </span>
        </a>
      )}

      {formOpen && (
        <div className="mt-3 space-y-2 rounded-lg border border-ink/15 p-3">
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-ink/70">
              Date
              <input
                type="date"
                value={date}
                min={localToday()}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded border border-ink/20 px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="w-28 text-xs text-ink/70">
              Start
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full rounded border border-ink/20 px-2 py-1 text-sm text-ink"
              />
            </label>
          </div>

          <div className="flex gap-2">
            <label className="w-32 text-xs text-ink/70">
              Duration
              <select
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="mt-1 w-full rounded border border-ink/20 px-2 py-1 text-sm text-ink"
              >
                {DURATIONS.map((d) => (
                  <option key={d.minutes} value={d.minutes}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex-1 text-xs text-ink/70">
              Gym
              <select
                value={gymId}
                onChange={(e) => setGymId(e.target.value)}
                className="mt-1 w-full rounded border border-ink/20 px-2 py-1 text-sm text-ink"
              >
                <option value="">Decide later</option>
                {userGyms.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={handlePropose}
            disabled={busy}
            className="w-full rounded-full bg-flame py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : "Propose"}
          </button>
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="mt-3 text-xs text-ink/60">
          No sessions yet, propose a time to train together.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {sessions.map((s) => {
            const isProposer = s.proposer_id === currentUserId;

            return (
              <li
                key={s.id}
                className="rounded-lg border border-ink/15 bg-white px-3 py-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {formatSlot(s.starts_at, s.ends_at)}
                    </p>
                    <p className="text-xs text-ink/60">
                      {s.gym_name ?? "Location TBC"}
                      {s.status === "proposed" &&
                        ` · proposed by ${isProposer ? "you" : s.proposer_name}`}
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

                {s.status === "proposed" && (
                  <div className="mt-2 flex gap-2">
                    {!isProposer && (
                      <button
                        type="button"
                        onClick={() => handleRespond(s.id, "confirm")}
                        disabled={busy}
                        className="rounded-full bg-flame px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Confirm
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRespond(s.id, "cancel")}
                      disabled={busy}
                      className="rounded-full border border-ink/25 px-3 py-1 text-xs font-semibold text-ink disabled:opacity-50"
                    >
                      {isProposer ? "Withdraw" : "Decline"}
                    </button>
                  </div>
                )}

                {s.status === "confirmed" && (
                  <a
                    href={`/api/sessions/${s.id}/ics`}
                    className="mt-2 inline-block rounded-full border border-ink/25 px-3 py-1 text-xs font-semibold text-ink"
                  >
                    Add to calendar
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}