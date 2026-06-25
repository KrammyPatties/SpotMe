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

/**
 * Shows display name if 1:1 chat, room name if group,
 * or a fallback if unnamed.
 */
export async function getChatroomLabel(
  chatroomId: string,
  clerkUserId: string
): Promise<string> {
  const { data: room } = await supabaseAdmin
    .from("chatrooms")
    .select("name")
    .eq("id", chatroomId)
    .maybeSingle();
 
  if (room?.name) return room.name;
 
  const { data: members } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id")
    .eq("chatroom_id", chatroomId);
 
  const others = (members ?? [])
    .map((m) => m.clerk_user_id)
    .filter((id) => id !== clerkUserId);
 
  if (others.length === 1) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("clerk_user_id", others[0])
      .maybeSingle();
    return profile?.display_name ?? "Unknown user";
  }
 
  return `Group (${(members ?? []).length})`;
}

export type Conversation = {
  chatroomId: string;
  label: string;          // other member's name (1:1) or room name (group)
  isGroup: boolean;
  lastMessage: string | null;
  lastMessageAt: string | null;
};
 
/**
 * Returns the current user's conversations, most recent first.
 * For a 1:1 room the label is the other member's display name and for a named
 * group it is the room name. For an unnamed group uses a member count fallback.
 *
 * Done with batched queries rather than nested joins.
 */
export async function getConversationsForUser(
  clerkUserId: string
): Promise<Conversation[]> {
  // 1. Check rooms user is in.
  const { data: myMemberships, error: memErr } = await supabaseAdmin
    .from("chatroom_members")
    .select("chatroom_id")
    .eq("clerk_user_id", clerkUserId);
 
  if (memErr) {
    console.error("getConversationsForUser: memberships failed:", memErr);
    return [];
  }
  const roomIds = (myMemberships ?? []).map((m) => m.chatroom_id);
  if (roomIds.length === 0) return [];
 
  // 2. Fetch the rooms.
  const { data: rooms } = await supabaseAdmin
    .from("chatrooms")
    .select("id, name")
    .in("id", roomIds);
 
  // 3. Get all members of those rooms.
  const { data: allMembers } = await supabaseAdmin
    .from("chatroom_members")
    .select("chatroom_id, clerk_user_id")
    .in("chatroom_id", roomIds);
 
  // 4. Profiles for every other member to resolve display names.
  const otherIds = Array.from(
    new Set(
      (allMembers ?? [])
        .map((m) => m.clerk_user_id)
        .filter((id) => id !== clerkUserId)
    )
  );
  const { data: profiles } = otherIds.length
    ? await supabaseAdmin
        .from("profiles")
        .select("clerk_user_id, display_name")
        .in("clerk_user_id", otherIds)
    : { data: [] as { clerk_user_id: string; display_name: string }[] };
 
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.display_name])
  );
 
  // 5. Latest message per room for sorting.
  const { data: recentMessages } = await supabaseAdmin
    .from("messages")
    .select("chatroom_id, content, created_at")
    .in("chatroom_id", roomIds)
    .order("created_at", { ascending: false });
 
  const lastByRoom = new Map<string, { content: string; created_at: string }>();
  for (const msg of recentMessages ?? []) {
    if (!lastByRoom.has(msg.chatroom_id)) {
      lastByRoom.set(msg.chatroom_id, {
        content: msg.content,
        created_at: msg.created_at,
      });
    }
  }
 
  // 6. Assemble and display.
  const membersByRoom = new Map<string, string[]>();
  for (const m of allMembers ?? []) {
    const arr = membersByRoom.get(m.chatroom_id) ?? [];
    arr.push(m.clerk_user_id);
    membersByRoom.set(m.chatroom_id, arr);
  }
 
  const conversations: Conversation[] = (rooms ?? []).map((room) => {
    const memberIds = membersByRoom.get(room.id) ?? [];
    const others = memberIds.filter((id) => id !== clerkUserId);
    const isGroup = memberIds.length > 2 || room.name !== null;
 
    let label: string;
    if (room.name) {
      label = room.name;
    } else if (others.length === 1) {
      label = nameById.get(others[0]) ?? "Unknown user";
    } else {
      label = `Group (${memberIds.length})`;
    }
 
    const last = lastByRoom.get(room.id) ?? null;
    return {
      chatroomId: room.id,
      label,
      isGroup,
      lastMessage: last?.content ?? null,
      lastMessageAt: last?.created_at ?? null,
    };
  });
 
  // Newest rooms first.
  conversations.sort((a, b) => {
    if (!a.lastMessageAt && !b.lastMessageAt) return 0;
    if (!a.lastMessageAt) return 1;
    if (!b.lastMessageAt) return -1;
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });
 
  return conversations;
}