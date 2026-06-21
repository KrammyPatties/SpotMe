import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Returns true if the given Clerk user is a member of the chatroom.
 * Used to both read chat history and write sending messages
 * so a conversation stays private to its participants.
 */
export async function isChatroomMember(
  chatroomId: string,
  clerkUserId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("chatroom_members")
    .select("chatroom_id")
    .eq("chatroom_id", chatroomId)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    console.error("isChatroomMember lookup failed:", error);
    return false;
  }

  return data !== null;
}