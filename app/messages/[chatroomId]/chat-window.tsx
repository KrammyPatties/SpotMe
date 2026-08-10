"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import RoomInfo from "./room-info";
import Avatar from "@/app/components/avatar";
import { shouldShowSenderName } from "@/lib/chat-view";

type Message = {
  id: string;
  chatroom_id: string;
  sender_id: string | null; // null for system messages
  type: "user" | "system";
  content: string;
  created_at: string;
  client_msg_id?: string | null; // set on messages we sent from this client
  pending?: boolean; // true while an optimistic message awaits confirmation
  failed?: boolean; // true when the send failed and can be retried
};

export default function ChatWindow({
  chatroomId,
  currentUserId,
  initialMessages,
  label,
  headerPhotoUrl,
  children,
  memberNames,
  isGroup,
}: {
  chatroomId: string;
  currentUserId: string;
  initialMessages: Message[];
  label?: string;
  headerPhotoUrl?: string | null;
  children?: React.ReactNode;
  memberNames: Record<string, string>;
  isGroup: boolean;
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
            const tempIdx = incoming.client_msg_id
              ? prev.findIndex(
                  (m) => m.client_msg_id === incoming.client_msg_id
                )
              : prev.findIndex(
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

async function postMessage(clientMsgId: string, content: string) {
    setMessages((prev) =>
      prev.map((m) =>
        m.client_msg_id === clientMsgId
          ? { ...m, pending: true, failed: false }
          : m
      )
    );

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatroom_id: chatroomId,
          content,
          client_msg_id: clientMsgId,
        }),
      });

      if (!res.ok) {
        if (res.status === 409) return;

        setMessages((prev) =>
          prev.map((m) =>
            m.client_msg_id === clientMsgId
              ? { ...m, pending: false, failed: true }
              : m
          )
        );
        const { error } = await res.json().catch(() => ({ error: "Failed" }));
        console.error("send failed:", error);
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.client_msg_id === clientMsgId
            ? { ...m, pending: false, failed: true }
            : m
        )
      );
      console.error("send error:", err);
    }
  }

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;

    setSending(true);
    setDraft("");

    const clientMsgId = crypto.randomUUID();
    const optimistic: Message = {
      id: clientMsgId,
      chatroom_id: chatroomId,
      sender_id: currentUserId,
      content,
      created_at: new Date().toISOString(),
      client_msg_id: clientMsgId,
      pending: true,
      type: "user",
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      await postMessage(clientMsgId, content);
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
        <Avatar url={headerPhotoUrl ?? null} name={label ?? "Chat"} size={32} />
        {label && <h1 className="font-semibold truncate">{label}</h1>}
        <div className="ml-auto flex items-center gap-3">
          <RoomInfo chatroomId={chatroomId} currentName={label ?? "Chat"} />
        </div>
      </div>

      {children}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((m, i) => {
          if (m.type === "system") {
            return (
              <div key={m.id} className="flex justify-center">
                <span className="text-xs text-ink/50 italic px-3 py-1">
                  {m.content}
                </span>
              </div>
            );
          }              
          const mine = m.sender_id === currentUserId;
          const showName = shouldShowSenderName(m, messages[i - 1] ?? null, currentUserId, isGroup);
          return (
            <div
              key={m.id}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div className="max-w-[75%]">
                {showName && m.sender_id && (
                  <span className="block text-xs font-medium text-ink/70 mb-0.5">
                    {memberNames[m.sender_id] ?? "Unknown"}
                  </span>
                )}
                <div
                  className={`rounded-lg px-3 py-2 ${
                    mine
                      ? "bg-flame text-white"
                      : "bg-cream text-ink border border-black/10"
                  } ${m.pending ? "opacity-60" : ""} ${
                    m.failed ? "opacity-60 border border-red-500" : ""
                  }`}
                >
                  {m.content}
                </div>
                {m.failed && m.client_msg_id && (
                  <button
                    onClick={() => postMessage(m.client_msg_id!, m.content)}
                    className="mt-1 text-xs text-red-600 underline"
                  >
                    Couldn&apos;t send — tap to retry
                  </button>
                )}
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