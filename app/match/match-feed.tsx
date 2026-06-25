"use client";

import { useState } from "react";
import type { ScoredCandidate } from "@/lib/matching";

type Card = ScoredCandidate & { photoUrl: string | null };

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MatchFeed({ cards }: { cards: Card[] }) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Stack exhausted (or empty to begin with)
  if (index >= cards.length) {
    return (
      <div className="rounded-lg border border-ink/20 bg-white p-8 text-center">
        <p className="text-lg font-medium">No more matches right now</p>
        <p className="mt-2 text-sm text-ink/60">
          Check back later, or widen your gym and availability options.
        </p>
      </div>
    );
  }

  const { candidate, breakdown, photoUrl, sharedActiveSg } = cards[index];

  // Top matching traits from the breakdown (only show signals that scored well)
  const traits: string[] = [];
  if (breakdown.sharedGym === 1) traits.push("Shares a gym with you");
  else if (sharedActiveSg) traits.push(`You're both near ${sharedActiveSg}!`);
  if (breakdown.availability > 0) traits.push("Available at similar times");
  if (breakdown.workoutStyle === 1) traits.push("Same workout style");
  if (breakdown.experiencePref === 1) traits.push("Matches your experience preference");

  function advance() {
    setExpanded(false);
    setIndex((i) => i + 1);
  }

  async function like() {
  const recipientId = candidate.clerk_user_id;
  advance(); // move to next card immediately (optimistic - don't make them wait)
  try {
    await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientId }),
    });
  } catch {
    // Silent for now - the request either lands or it doesn't; we've already advanced
    // (A notification could be added later)
  }
}

  return (
    <div className="flex flex-col items-center">
      {/* Card */}
      <div className="relative w-full overflow-hidden rounded-2xl border border-ink/15 bg-white shadow-sm">
        {/* Photo (3:4) or placeholder */}
        <div className="relative aspect-[3/4] w-full bg-ink/10">
          {photoUrl ? (
            <img src={photoUrl} alt={candidate.display_name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-6xl font-bold text-ink/30">
              {candidate.display_name.charAt(0).toUpperCase()}
            </div>
          )}

          {/* Name + age overlay at the bottom of the photo */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
            <h2 className="text-xl font-bold text-white">
              {candidate.display_name}
              {candidate.age != null && <span className="font-normal">, {candidate.age}</span>}
            </h2>
          </div>
        </div>

        {/* Traits + expand */}
        <div className="p-4">
          {traits.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {traits.map((t) => (
                <li key={t} className="rounded-full bg-flame/10 px-3 py-1 text-sm text-flame">
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink/50">No strong matches yet - still worth a look</p>
          )}

          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="mt-3 text-sm font-medium text-flame hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>

          {expanded && (
            <div className="mt-3 grid gap-2 text-sm text-ink/80">
              {candidate.bio && <p>{candidate.bio}</p>}
              <p><span className="font-medium">Experience:</span> {candidate.experience}</p>
              {candidate.workout_style && (
                <p><span className="font-medium">Style:</span> {candidate.workout_style}</p>
              )}
              {candidate.gyms.length > 0 && (
                <p><span className="font-medium">Gyms:</span> {candidate.gyms.map((g) => g.name).join(", ")}</p>
              )}
              {candidate.availability.length > 0 && (
                <p>
                  <span className="font-medium">Available:</span>{" "}
                  {candidate.availability.map((a) => `${DAY_LABELS[a.day]} ${a.time}`).join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Like / dislike buttons (not wired yet - both just advance for now) */}
      <div className="mt-6 flex items-center justify-center gap-8">
        <button
          type="button"
          onClick={advance}
          aria-label="Pass"
          className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-ink/30 text-2xl text-ink/60 hover:bg-ink/5"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={like}
          aria-label="Like"
          className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-flame text-2xl text-flame hover:bg-flame hover:text-cream"
        >
          🏋
        </button>
      </div>
    </div>
  );
}