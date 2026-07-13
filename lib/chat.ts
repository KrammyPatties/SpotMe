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

/**
 * Finds an existing 1:1 chatroom containing exactly the two given users
 * or null if none exists. Used to prevent duplicate rooms for the same pair.
 *
 * Batched approach: get the rooms userA is in, get the rooms userB is in,
 * intersect and keep only rooms whose member count is exactly 2.
 */
async function findDirectChatroom(
  userA: string,
  userB: string
): Promise<string | null> {
  const { data: aRooms } = await supabaseAdmin
    .from("chatroom_members")
    .select("chatroom_id")
    .eq("clerk_user_id", userA);
 
  const { data: bRooms } = await supabaseAdmin
    .from("chatroom_members")
    .select("chatroom_id")
    .eq("clerk_user_id", userB);
 
  const aSet = new Set((aRooms ?? []).map((r) => r.chatroom_id));
  const shared = (bRooms ?? [])
    .map((r) => r.chatroom_id)
    .filter((id) => aSet.has(id));
 
  if (shared.length === 0) return null;
 
  // Of the rooms they share, find one with exactly 2 members.
  const { data: counts } = await supabaseAdmin
    .from("chatroom_members")
    .select("chatroom_id")
    .in("chatroom_id", shared);
 
  const sizeByRoom = new Map<string, number>();
  for (const row of counts ?? []) {
    sizeByRoom.set(row.chatroom_id, (sizeByRoom.get(row.chatroom_id) ?? 0) + 1);
  }
 
  for (const roomId of shared) {
    if (sizeByRoom.get(roomId) === 2) return roomId;
  }
  return null;
}
 
/**
 * Ensures a 1:1 chatroom exists for an accepted match, returning its id.
 * Verifies the match is accepted and the caller is a participant before
 * creating anything. Repeat calls return the same room.
 */
export async function getOrCreateChatroomForMatch(
  matchId: string,
  clerkUserId: string
): Promise<string | null> {
  const { data: match, error } = await supabaseAdmin
    .from("matches")
    .select("initiator_id, recipient_id, status")
    .eq("id", matchId)
    .maybeSingle();
 
  if (error || !match) {
    console.error("getOrCreateChatroomForMatch: match not found:", error);
    return null;
  }
 
  // Authorisation: only a participant can spawn the room.
  const participants = [match.initiator_id, match.recipient_id];
  if (!participants.includes(clerkUserId)) return null;
 
  if (match.status !== "accepted") return null;
 
  // Reuse an existing 1:1 room for this pair if there is one.
  const existing = await findDirectChatroom(
    match.initiator_id,
    match.recipient_id
  );
  if (existing) return existing;
 
  // Create the room then add both members.
  const { data: room, error: roomErr } = await supabaseAdmin
    .from("chatrooms")
    .insert({ name: null })
    .select("id")
    .single();
 
  if (roomErr || !room) {
    console.error("chatroom insert failed:", roomErr);
    return null;
  }
 
  const { error: memErr } = await supabaseAdmin
    .from("chatroom_members")
    .insert([
      { chatroom_id: room.id, clerk_user_id: match.initiator_id },
      { chatroom_id: room.id, clerk_user_id: match.recipient_id },
    ]);
 
  if (memErr) {
    console.error("chatroom_members insert failed:", memErr);
    await supabaseAdmin.from("chatrooms").delete().eq("id", room.id);
    return null;
  }
 
  return room.id;
}
 
/**
 * For every accepted match the user is part of, ensure a chatroom exists.
 */
export async function ensureChatroomsForUser(clerkUserId: string): Promise<void> {
  const { data: matches, error } = await supabaseAdmin
    .from("matches")
    .select("id, initiator_id, recipient_id, status")
    .eq("status", "accepted")
    .or(`initiator_id.eq.${clerkUserId},recipient_id.eq.${clerkUserId}`);
 
  if (error) {
    console.error("ensureChatroomsForUser: matches lookup failed:", error);
    return;
  }
 
  for (const match of matches ?? []) {
    await getOrCreateChatroomForMatch(match.id, clerkUserId);
  }
}

/**
 * Returns the set of clerk_user_ids who are accepted matches of any of the
 * given member ids. Used to decide who is eligible to be added to a room.
 * The candidate must be an accepted match of at least one current member.
 */
async function acceptedMatchIdsForMembers(
  memberIds: string[]
): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();

  // Matches where a current member is on either side and status is accepted.
  const orInitiator = `initiator_id.in.(${memberIds.join(",")})`;
  const orRecipient = `recipient_id.in.(${memberIds.join(",")})`;

  const { data, error } = await supabaseAdmin
    .from("matches")
    .select("initiator_id, recipient_id, status")
    .eq("status", "accepted")
    .or(`${orInitiator},${orRecipient}`);

  if (error) {
    console.error("acceptedMatchIdsForMembers failed:", error);
    return new Set();
  }

  const memberSet = new Set(memberIds);
  const eligible = new Set<string>();
  for (const m of data ?? []) {
    // The "other side" of each accepted match involving a member is eligible.
    if (memberSet.has(m.initiator_id)) eligible.add(m.recipient_id);
    if (memberSet.has(m.recipient_id)) eligible.add(m.initiator_id);
  }
  // Don't offer people already in the room.
  for (const id of memberIds) eligible.delete(id);
  return eligible;
}

/**
 * The list of users the given member may add to the room: accepted matches of
 * any current member, excluding people already in the room. Returns id + name.
 */
export async function getAddableUsers(
  chatroomId: string,
  requesterId: string
): Promise<{ clerkUserId: string; displayName: string }[]> {
  // Requester must be a member.
  if (!(await isChatroomMember(chatroomId, requesterId))) return [];

  const { data: members } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id")
    .eq("chatroom_id", chatroomId);

  const memberIds = (members ?? []).map((m) => m.clerk_user_id);
  const eligible = await acceptedMatchIdsForMembers(memberIds);
  if (eligible.size === 0) return [];

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, display_name")
    .in("clerk_user_id", [...eligible]);

  return (profiles ?? []).map((p) => ({
    clerkUserId: p.clerk_user_id,
    displayName: p.display_name ?? "Unknown user",
  }));
}

/**
 * Adds a user to a chatroom. Authorises only if the requester is a member and the
 * target must be an accepted match of at least one current member. Promotes
 * the room to a named group if it becomes >2 people and has no name yet.
 * Returns true on success.
 */
export async function addMemberToChatroom(
  chatroomId: string,
  requesterId: string,
  targetId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!(await isChatroomMember(chatroomId, requesterId))) {
    return { ok: false, reason: "requester not a member" };
  }

  if (await isChatroomMember(chatroomId, targetId)) {
    return { ok: true };
  }

  const { data: members } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id")
    .eq("chatroom_id", chatroomId);
  const memberIds = (members ?? []).map((m) => m.clerk_user_id);

  const eligible = await acceptedMatchIdsForMembers(memberIds);
  if (!eligible.has(targetId)) {
    return { ok: false, reason: "target is not an accepted match of any member" };
  }

  const { error: insErr } = await supabaseAdmin
    .from("chatroom_members")
    .insert({
      chatroom_id: chatroomId,
      clerk_user_id: targetId,
      added_by: requesterId,
    });
  if (insErr) {
    console.error("addMemberToChatroom insert failed:", insErr);
    return { ok: false, reason: "insert failed" };
  }

  // If the room is now a group >2 and unnamed, give it a default name so the
  // list/header stop labelling it as a 1:1.
  const newCount = memberIds.length + 1;
  if (newCount > 2) {
    const { data: room } = await supabaseAdmin
      .from("chatrooms")
      .select("name")
      .eq("id", chatroomId)
      .maybeSingle();
    if (room && !room.name) {
      await supabaseAdmin
        .from("chatrooms")
        .update({ name: "Group chat" })
        .eq("id", chatroomId);
    }
  }

  return { ok: true };
}