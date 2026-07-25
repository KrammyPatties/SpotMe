"use client";

// One submit covers every member still awaiting a rating. Stars are required,
// written feedback is optional.
//
// Written feedback is never shown to the person it's about — the profile
// renders the aggregate only. In a 1:1 an attributed comment is trivially
// traceable, and people stop reporting safety concerns honestly when they know
// their partner will read it. The text is retained for Feature 7 moderation.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PendingRating } from "@/lib/supabase/ratings";

type Props = { target: PendingRating };

type Entry = { score: number; review: string };

function StarInput({
  value,
  onChange,
  name,
}: {
  value: number;
  onChange: (n: number) => void;
  name: string;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label={`Rating for ${name}`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = n <= value;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            aria-pressed={active}
            className="text-2xl leading-none"
            // Inline colour: Tailwind v4 has silently produced nothing for
            // opacity-modified brand classes in some contexts.
            style={{ color: active ? "#f95311" : "#c9c2b8" }}
          >
            {active ? "★" : "☆"}
          </button>
        );
      })}
    </div>
  );
}

export default function RatingForm({ target }: Props) {
  const router = useRouter();

  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      target.pendingMembers.map((m) => [m.clerkUserId, { score: 0, review: "" }])
    )
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allScored = target.pendingMembers.every(
    (m) => (entries[m.clerkUserId]?.score ?? 0) > 0
  );

  function update(id: string, patch: Partial<Entry>) {
    setEntries((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSubmit() {
    if (!allScored || busy) return;
    setError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: target.sessionId,
          ratings: target.pendingMembers.map((m) => ({
            ratee_id: m.clerkUserId,
            score: entries[m.clerkUserId].score,
            review: entries[m.clerkUserId].review.trim() || null,
          })),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Couldn't submit your ratings");
        return;
      }

      router.push(`/messages/${target.chatroomId}`);
      router.refresh();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <p className="text-sm text-ink/60">
        {new Date(target.startsAt).toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
        {target.gymName ? ` · ${target.gymName}` : ""}
      </p>
      <h1 className="mt-1 text-xl font-semibold text-ink">Rate your session</h1>
      <p className="mt-1 text-xs text-ink/50">
        Your written feedback stays private and is not shown on their profile.
      </p>

      {error && (
        <p className="mt-3 rounded border border-flame/40 bg-flame/10 px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}

      <div className="mt-5 space-y-5">
        {target.pendingMembers.map((m) => (
          <div
            key={m.clerkUserId}
            className="rounded-lg border border-black/10 bg-white p-4"
          >
            <h2 className="font-semibold text-ink">{m.displayName}</h2>

            <label className="mt-3 block text-sm text-ink/70">
              Rate how working out with {m.displayName} was
            </label>
            <div className="mt-1">
              <StarInput
                name={m.displayName}
                value={entries[m.clerkUserId]?.score ?? 0}
                onChange={(n) => update(m.clerkUserId, { score: n })}
              />
            </div>

            <label className="mt-4 block text-sm text-ink/70">
              Any notable feedback on {m.displayName}&apos;s behaviour?
              <textarea
                value={entries[m.clerkUserId]?.review ?? ""}
                onChange={(e) =>
                  update(m.clerkUserId, { review: e.target.value })
                }
                maxLength={1000}
                rows={3}
                placeholder="Optional"
                className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-ink"
              />
            </label>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!allScored || busy}
        className="mt-5 w-full rounded-full bg-flame py-3 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Submit ratings"}
      </button>

      {!allScored && (
        <p className="mt-2 text-center text-xs text-ink/50">
          Give a star rating for everyone to submit.
        </p>
      )}
    </div>
  );
}
