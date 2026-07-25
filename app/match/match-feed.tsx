"use client";

import { useState } from "react";
import type { ScoredCandidate } from "@/lib/matching";
import { toLabel } from "@/lib/labels";
import {
  buildAvailabilityGrid,
  DAY_LABELS,
  TIME_LABELS,
  type Slot,
} from "@/lib/availability";
import RatingBadge from "@/app/components/rating-badge";
import type { RatingAggregate } from "@/lib/ratings";

type Card = ScoredCandidate & {
  photoUrl: string | null;
  ratingAggregate: RatingAggregate | null;
};
type RequestCard = {
  matchId: string;
  requester: { display_name: string; age: number | null; experience: string; bio: string | null; workout_style: string | null };
  photoUrl: string | null;
  ratingAggregate: RatingAggregate | null;
};

export function MatchFeed({
  cards,
  requestCards,
  userAvailability,
}: {
  cards: Card[];
  requestCards: RequestCard[];
  userAvailability: Slot[];
}) {
  const [tab, setTab] = useState<"discover" | "requests">("discover");
  const [requests, setRequests] = useState(requestCards);
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const current = index < cards.length ? cards[index] : null;

  // Top matching traits from the breakdown (only show signals that scored well)
  const traits: string[] = [];
  if (current) {
    if (current.breakdown.sharedGym === 1) traits.push("Shares a gym with you");
    else if (current.sharedActiveSg) traits.push(`You're both near ${current.sharedActiveSg}!`);
    if (current.breakdown.availability > 0) traits.push("Available at similar times");
    if (current.breakdown.workoutStyle === 1) traits.push("Same workout style");
    if (current.breakdown.experiencePref === 1) traits.push("Matches your experience preference");
  }
  
  function advance() {
    setExpanded(false);
    setIndex((i) => i + 1);
  }

  async function like() {
    if (!current) return;
    const recipientId = current.candidate.clerk_user_id;
    advance();
    try {
      await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId }),
      });
    } catch {
      // silent
    }
  }

  async function respond(matchId: string, action: "accept" | "decline") {
    setRequests((rs) => rs.filter((r) => r.matchId !== matchId));
    try {
      await fetch("/api/matches/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, action }),
      });
    } catch {
      // silent for now
    }
  }

return (
    <div>
      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-ink/15">
        <button
          type="button"
          onClick={() => setTab("discover")}
          className={`px-4 py-2 text-sm font-medium ${tab === "discover" ? "border-b-2 border-flame text-flame" : "text-ink/60"}`}
        >
          Discover
        </button>
        <button
          type="button"
          onClick={() => setTab("requests")}
          className={`px-4 py-2 text-sm font-medium ${tab === "requests" ? "border-b-2 border-flame text-flame" : "text-ink/60"}`}
        >
          Requests{requests.length > 0 && ` (${requests.length})`}
        </button>
      </div>

      {tab === "discover" ? (
        !current ? (
          <div className="rounded-lg border border-ink/20 bg-white p-8 text-center">
            <p className="text-lg font-medium">No more matches right now</p>
            <p className="mt-2 text-sm text-ink/60">
              Check back later, or widen your gym and availability options.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            {/* Card */}
            <div className="relative w-full overflow-hidden rounded-2xl border border-ink/15 bg-white shadow-sm">
              <div className="relative aspect-[3/4] w-full bg-ink/10">
                {current.photoUrl ? (
                  <img src={current.photoUrl} alt={current.candidate.display_name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-6xl font-bold text-ink/30">
                    {current.candidate.display_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                  <h2 className="text-xl font-bold text-white">
                    {current.candidate.display_name}
                    {current.candidate.age != null && <span className="font-normal">, {current.candidate.age}</span>}
                  </h2>
                </div>
              </div>

              <div className="p-4">
                {current.ratingAggregate && (
                  <div className="mb-3">
                    <RatingBadge aggregate={current.ratingAggregate} size="sm" />
                  </div>
                )}
                {traits.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {traits.map((t) => (
                      <li key={t} className="rounded-full bg-flame/10 px-3 py-1 text-sm text-flame">{t}</li>
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
                    {current.candidate.bio && (
                      <p className="rounded-lg border border-ink/10 bg-cream/60 px-3 py-2 text-ink/80">
                        {current.candidate.bio}
                      </p>
                    )}
                    <p><span className="font-medium">Experience:</span> {toLabel(current.candidate.experience)}</p>
                    {current.candidate.workout_style && (
                      <p><span className="font-medium">Style:</span> {toLabel(current.candidate.workout_style, "style")}</p>
                    )}
                    {current.ratingAggregate && (
                      <RatingBadge aggregate={current.ratingAggregate} size="sm" />
                    )}
                    {current.candidate.gyms.length > 0 && (
                      <p><span className="font-medium">Gyms:</span> {current.candidate.gyms.map((g) => g.name).join(", ")}</p>
                    )}
                    {current.candidate.availability.length > 0 && (
                      <div>
                        <span className="font-medium">Available:</span>
                        <AvailabilityGrid
                          candidateAvailability={current.candidate.availability}
                          userAvailability={userAvailability}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Like / dislike buttons */}
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
        )
      ) : (
        /* Requests list */
        <div className="grid gap-3">
          {requests.length === 0 ? (
            <p className="py-8 text-center text-ink/60">No pending requests right now.</p>
          ) : (
            requests.map((r) => (
              <div key={r.matchId} className="flex items-center gap-3 rounded-xl border border-ink/15 bg-white p-3">
                <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-ink/10">
                  {r.photoUrl ? (
                    <img src={r.photoUrl} alt={r.requester.display_name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl font-bold text-ink/30">
                      {r.requester.display_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {r.requester.display_name}
                    {r.requester.age != null && <span className="font-normal">, {r.requester.age}</span>}
                  </p>
                  <p className="truncate text-sm text-ink/60">
                    {toLabel(r.requester.experience)}
                    {r.requester.workout_style ? ` · ${toLabel(r.requester.workout_style, "style")}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => respond(r.matchId, "decline")}
                    className="rounded-full border border-ink/30 px-3 py-1 text-sm text-ink/60 hover:bg-ink/5"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(r.matchId, "accept")}
                    className="rounded-full bg-flame px-3 py-1 text-sm font-medium text-cream hover:opacity-90"
                  >
                    Accept
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 7x3 availability grid. Solid flame = you're both free (you can actually
 * meet); translucent flame = only they're free; empty = they're not free.
 */
function AvailabilityGrid({
  candidateAvailability,
  userAvailability,
}: {
  candidateAvailability: Slot[];
  userAvailability: Slot[];
}) {
  const grid = buildAvailabilityGrid(candidateAvailability, userAvailability);

  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {/* Spacer above the day labels column */}
        <div className="w-8" />
        {TIME_LABELS.map((t) => (
          <div key={t} className="flex-1 text-center text-xs text-ink/50">
            {t}
          </div>
        ))}
      </div>

      {grid.map((row, dayIdx) => (
        <div key={dayIdx} className="mt-1 flex items-center gap-1">
          <div className="w-8 text-xs text-ink/50">{DAY_LABELS[dayIdx]}</div>
          {row.map((state, timeIdx) => (
            <div
              key={timeIdx}
              className="h-5 flex-1 rounded"
              style={{
                backgroundColor:
                  state === "shared"
                    ? "#f95311"
                    : state === "candidate"
                      ? "rgba(249, 83, 17, 0.25)"
                      : "rgba(17, 17, 17, 0.05)",
              }}
            />
          ))}
        </div>
      ))}

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink/50">
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-3 w-3 rounded"
            style={{ backgroundColor: "#f95311" }}
          />{" "}
          Both free
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-3 w-3 rounded"
            style={{ backgroundColor: "rgba(249, 83, 17, 0.25)" }}
          />{" "}
          They&apos;re free
        </span>
      </div>
    </div>
  );
}