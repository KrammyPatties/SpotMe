"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Member = {
  clerkUserId: string;
  displayName: string;
  isAdmin: boolean;
  addedBy: string | null;
};

export default function RoomInfo({
  chatroomId,
  currentUserId,
  currentName,
}: {
  chatroomId: string;
  currentUserId: string;
  currentName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isGroup = members.length >= 3;

  async function openPanel() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/messages/members/list?chatroom_id=${chatroomId}`
      );
      const json = await res.json();
      if (res.ok) {
        setMembers(json.members ?? []);
        setViewerIsAdmin(json.viewerIsAdmin ?? false);
      } else {
        setMembers([]);
        setError(json.error ?? "Failed to load");
      }
    } catch {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function refreshMembers() {
    const res = await fetch(
      `/api/messages/members/list?chatroom_id=${chatroomId}`
    );
    const json = await res.json();
    if (res.ok) {
      setMembers(json.members ?? []);
      setViewerIsAdmin(json.viewerIsAdmin ?? false);
    }
  }

  async function saveName() {
    setError(null);
    try {
      const res = await fetch("/api/messages/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatroom_id: chatroomId, name: draftName }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Couldn't rename");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Couldn't rename");
    }
  }

  async function removeMember(targetId: string) {
    setError(null);
    try {
      const res = await fetch("/api/messages/members/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatroom_id: chatroomId, target_id: targetId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Couldn't remove");
        return;
      }
      await refreshMembers();
      router.refresh();
    } catch {
      setError("Couldn't remove");
    }
  }

  async function leaveGroup() {
    setError(null);
    try {
      const res = await fetch("/api/messages/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatroom_id: chatroomId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Couldn't leave");
        return;
      }
      router.push("/messages");
    } catch {
      setError("Couldn't leave");
    }
  }

  return (
    <div className="relative">
      <button
        onClick={openPanel}
        aria-label="Room info and members"
        className="text-sm text-ink/70 hover:text-flame"
      >
        Members
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-lg border bg-cream shadow-lg z-10 p-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold">Chat details</span>
            <button
              onClick={() => setOpen(false)}
              className="text-ink/50 hover:text-ink"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Editable name */}
          <div className="mb-3">
            <label className="block text-xs text-ink/50 mb-1">Name</label>
            {editing ? (
              <div className="flex gap-1">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Chat name (blank to reset)"
                  className="flex-1 rounded border px-2 py-1 text-sm"
                />
                <button
                  onClick={saveName}
                  className="rounded bg-flame text-white px-2 py-1 text-sm"
                >
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm truncate">{currentName}</span>
                <button
                  onClick={() => {
                    setDraftName("");
                    setEditing(true);
                  }}
                  className="text-xs text-flame hover:underline shrink-0 ml-2"
                >
                  Rename
                </button>
              </div>
            )}
          </div>

          {/* Members roster */}
          <div>
            <span className="block text-xs text-ink/50 mb-1">
              Members{members.length ? ` (${members.length})` : ""}
            </span>
            {loading && <p className="text-sm text-ink/60">Loading…</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <ul className="max-h-48 overflow-y-auto">
              {members.map((m) => {
                const isSelf = m.clerkUserId === currentUserId;
                return (
                  <li
                    key={m.clerkUserId}
                    className="flex items-center justify-between py-1 text-sm"
                  >
                    <span className="truncate">
                      {m.displayName}
                      {isSelf && " (you)"}
                      {m.isAdmin && (
                        <span className="ml-1 text-xs text-flame">· admin</span>
                      )}
                    </span>
                    {/* Remove button: only if viewer is admin, and not on self */}
                    {viewerIsAdmin && !isSelf && (
                      <button
                        onClick={() => removeMember(m.clerkUserId)}
                        className="text-xs text-red-600 hover:underline shrink-0 ml-2"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Leave group: groups (3+) only */}
          {isGroup && (
            <div className="mt-3 pt-3 border-t">
              <button
                onClick={leaveGroup}
                className="text-sm text-red-600 hover:underline"
              >
                Leave group
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}