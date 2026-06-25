import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isChatroomMember, getChatroomLabel } from "@/lib/chat";
import ChatWindow from "./chat-window";

// Server component: authenticates, authorises and loads history
// for the client component live view.
export default async function ChatroomPage({
  params,
}: {
  params: Promise<{ chatroomId: string }>;
}) {
  const { chatroomId } = await params;

  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) redirect("/");

  // Authorisation: non-members cannot see this room. Reuses the same helper
  // the send endpoint uses, so reads and writes share one rule.
  const member = await isChatroomMember(chatroomId, userId);
  if (!member) redirect("/messages");

  // Initial history load.
  const { data: messages, error } = await supabaseAdmin
    .from("messages")
    .select("id, chatroom_id, sender_id, content, created_at")
    .eq("chatroom_id", chatroomId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("history load failed:", error);
  }

  const label = await getChatroomLabel(chatroomId, userId);

  return (
    <ChatWindow
      chatroomId={chatroomId}
      currentUserId={userId}
      initialMessages={messages ?? []}
      label={label}
    />
  );
}