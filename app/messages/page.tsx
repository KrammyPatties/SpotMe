import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getConversationsForUser, ensureChatroomsForUser } from "@/lib/chat";
import NewGroup from "./new-group";

export default async function MessagesPage() {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) redirect("/");

  // Lazy creation: make sure every accepted match has a room before we list.
  await ensureChatroomsForUser(userId);

  const conversations = await getConversationsForUser(userId);

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Messages</h1>
        <NewGroup />
      </div>

      {conversations.length === 0 ? (
        <p className="text-ink/60">
          No conversations yet. Once you match with someone, your chats will
          appear here.
        </p>
      ) : (
        <ul className="divide-y divide-black/10">
          {conversations.map((c) => (
            <li key={c.chatroomId}>
              <Link
                href={`/messages/${c.chatroomId}`}
                className="flex items-center justify-between gap-3 py-3 px-2 hover:bg-flame/5 rounded-lg"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.label}</p>
                  <p className="text-sm text-ink/60 truncate">
                    {c.lastMessage ?? "No messages yet"}
                  </p>
                </div>
                {c.lastMessageAt && (
                  <time className="text-xs text-ink/50 shrink-0">
                    {new Date(c.lastMessageAt).toLocaleDateString()}
                  </time>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}