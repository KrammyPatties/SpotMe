"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Addable = { clerkUserId: string; displayName: string };

export default function AddToChat({ chatroomId }: { chatroomId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<Addable[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function openPicker() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/messages/members/addable?chatroom_id=${chatroomId}`
      );
      const json = await res.json();
      setUsers(res.ok ? json.users : []);
      if (!res.ok) setError(json.error ?? "Failed to load");
    } catch {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function add(targetId: string) {
    setError(null);
    try {
      const res = await fetch("/api/messages/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatroom_id: chatroomId, target_id: targetId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Couldn't add");
        return;
      }
      // Remove from the list and refresh the room (new member, maybe new name).
      setUsers((prev) => prev.filter((u) => u.clerkUserId !== targetId));
      router.refresh();
    } catch {
      setError("Couldn't add");
    }
  }

  return (
    <div className="relative">
      <button
        onClick={openPicker}
        className="text-sm text-ink/70 hover:text-flame"
      >
        + Add
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-lg border bg-cream shadow-lg z-10 p-2">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-sm font-medium">Add to chat</span>
            <button
              onClick={() => setOpen(false)}
              className="text-ink/50 hover:text-ink"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {loading && <p className="text-sm text-ink/60 px-1">Loading…</p>}
          {error && <p className="text-sm text-red-600 px-1">{error}</p>}
          {!loading && !error && users.length === 0 && (
            <p className="text-sm text-ink/60 px-1">
              No one to add. Match with more people first.
            </p>
          )}

          <ul className="max-h-56 overflow-y-auto">
            {users.map((u) => (
              <li key={u.clerkUserId}>
                <button
                  onClick={() => add(u.clerkUserId)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-flame/10 text-sm"
                >
                  {u.displayName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}