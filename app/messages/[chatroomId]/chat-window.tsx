"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import AddToChat from "./add-to-chat";

type Message = {
  id: string;
  chatroom_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  pending?: boolean; // true while an optimistic message awaits confirmation
};

export default function ChatWindow({
  chatroomId,
  currentUserId,
  initialMessages,
  label,
}: {
  chatroomId: string;
  currentUserId: string;
  initialMessages: Message[];
  label?: string;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Filter subscription to just this chatroom.
  useEffect(() => {
    const channel = supabaseBrowser
      .channel(`messages:${chatroomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `chatroom_id=eq.${chatroomId}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          setMessages((prev) => {
            // If this echoes one of our own optimistic messages, replace the
            // temp row instead of adding a duplicate.
            const tempIdx = prev.findIndex(
              (m) =>
                m.pending &&
                m.sender_id === incoming.sender_id &&
                m.content === incoming.content
            );
            if (tempIdx !== -1) {
              const next = [...prev];
              next[tempIdx] = incoming;
              return next;
            }
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
        }
      )
      .subscribe();

    // Clean up the subscription when the component unmounts or chatroomId changes.
    return () => {
      supabaseBrowser.removeChannel(channel);
    };
  }, [chatroomId]);

  // Keep the screen pinned to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;

    setSending(true);
    setDraft("");

    // Optimistic: show the message immediately with a temporary id.
    const tempId = `temp-${crypto.randomUUID()}`;
    const optimistic: Message = {
      id: tempId,
      chatroom_id: chatroomId,
      sender_id: currentUserId,
      content,
      created_at: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatroom_id: chatroomId, content }),
      });
      if (!res.ok) {
        // Roll back the optimistic message on failure.
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        const { error } = await res.json().catch(() => ({ error: "Failed" }));
        console.error("send failed:", error);
      }
      // Error catching is also here to handle network errors or other unexpected issues.
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      console.error("send error:", err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-[80vh] max-w-2xl mx-auto">
      <div className="flex items-center gap-3 p-3 border-b">
        <Link
          href="/messages"
          aria-label="Back to messages"
          className="flex items-center gap-1 text-ink/70 hover:text-flame shrink-0"
        >
          <span aria-hidden="true">←</span>
          <span className="text-sm">Back</span>
        </Link>
        {label && <h1 className="font-semibold truncate">{label}</h1>}
        <div className="ml-auto">
          <AddToChat chatroomId={chatroomId} />
        </div>
        </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((m) => {
          const mine = m.sender_id === currentUserId;
          return (
            <div
              key={m.id}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`rounded-lg px-3 py-2 max-w-[75%] ${
                  mine
                    ? "bg-flame text-white"
                    : "bg-cream text-ink border border-black/10"
                } ${m.pending ? "opacity-60" : ""}`}
              >
                {m.content}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 p-4 border-t">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          placeholder="Type a message..."
          className="flex-1 rounded-lg border px-3 py-2"
        />
        <button
          onClick={handleSend}
          disabled={sending || !draft.trim()}
          className="rounded-lg bg-flame text-white px-4 py-2 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}