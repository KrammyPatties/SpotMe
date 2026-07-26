import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { isChatroomMember, getChatroomLabel } from "@/lib/chat";
import {
  getSessionsForChatroom,
  ensureCompletedSessions,
} from "@/lib/supabase/sessions";
import { getPendingRatingSessionIds } from "@/lib/supabase/ratings";
import SessionLog from "./session-log";

export default async function SessionLogPage({
  params,
}: {
  params: Promise<{ chatroomId: string }>;
}) {
  const { chatroomId } = await params;

  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) redirect("/");

  const member = await isChatroomMember(chatroomId, userId);
  if (!member) redirect("/messages");

  // Sweep before reading, so a session that has just ended shows as completed
  // here rather than lingering under Upcoming.
  await ensureCompletedSessions(chatroomId);

  const [sessions, pendingRatingIds, label] = await Promise.all([
    // All four statuses — this page is the history the panel no longer shows.
    getSessionsForChatroom(chatroomId, [
      "proposed",
      "confirmed",
      "completed",
      "cancelled",
    ]),
    getPendingRatingSessionIds(chatroomId, userId),
    getChatroomLabel(chatroomId, userId),
  ]);

  return (
    <div className="mx-auto flex h-[80vh] max-w-2xl flex-col">
      <div className="flex items-center gap-3 border-b p-3">
        <Link
          href={`/messages/${chatroomId}`}
          aria-label="Back to chat"
          className="flex shrink-0 items-center gap-1 text-ink/70 hover:text-flame"
        >
          <span aria-hidden="true">←</span>
          <span className="text-sm">Back</span>
        </Link>
        <h1 className="truncate font-semibold">
          {label ? `${label} · Sessions` : "Sessions"}
        </h1>
      </div>

      <SessionLog
        chatroomId={chatroomId}
        sessions={sessions}
        pendingRatingIds={pendingRatingIds}
      />
    </div>
  );
}
