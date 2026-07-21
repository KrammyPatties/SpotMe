"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AcceptedMatch = { clerkUserId: string; displayName: string };

export default function NewGroup() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [matches, setMatches] = useState<AcceptedMatch[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open the modal and lazily fetch accepted matches for the picker.
  async function openModal() {
    setOpen(true);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/matches/accepted");
      const data = await res.json();
      setMatches(data.matches ?? []);
    } catch {
      setError("Could not load your matches.");
    } finally {
      setLoading(false);
    }
  }

  function closeModal() {
    setOpen(false);
    setName("");
    setSelected(new Set());
    setError(null);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canSubmit = name.trim().length > 0 && selected.size >= 2 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/chatrooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          member_ids: [...selected],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create group.");
        setSubmitting(false);
        return;
      }
      router.push(`/messages/${data.chatroomId}`);
    } catch {
      setError("Could not create group.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        className="bg-flame text-white text-sm font-medium px-3 py-1.5 rounded-lg hover:opacity-90"
      >
        New group
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
          onClick={closeModal}
        >
          <div
            className="bg-cream border border-black/10 rounded-xl max-w-md w-full p-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-3">New group chat</h2>

            <label className="block text-sm font-medium mb-1">Group name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="e.g. Leg day crew"
              className="w-full border border-black/15 rounded-lg px-3 py-2 mb-4 bg-white"
            />

            <p className="text-sm font-medium mb-1">
              Add members{" "}
              <span className="text-ink/50 font-normal">
                (pick at least 2)
              </span>
            </p>

            {loading ? (
              <p className="text-sm text-ink/60 py-4">Loading your matches…</p>
            ) : matches.length === 0 ? (
              <p className="text-sm text-ink/60 py-4">
                You have no accepted matches to add yet.
              </p>
            ) : (
              <ul className="divide-y divide-black/10 mb-4">
                {matches.map((m) => (
                  <li key={m.clerkUserId}>
                    <label className="flex items-center gap-3 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.has(m.clerkUserId)}
                        onChange={() => toggle(m.clerkUserId)}
                      />
                      <span>{m.displayName}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {error && <p className="text-sm text-flame mb-3">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={closeModal}
                className="text-sm px-3 py-1.5 rounded-lg hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="bg-flame text-white text-sm font-medium px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? "Creating…" : "Create group"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}