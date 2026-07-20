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
 * Builds the display label for a room from a viewer's perspective.
 * Priority:
 *   1. A custom name someone set (chatrooms.name).
 *   2. Group (>2 members), unnamed to up to 3 other members' names, then "…".
 *   3. 1:1 (2 members), unnamed to the other member's name.
 *   4. Fallback to "Group chat".
 * Computed at render so it stays correct as membership changes.
 */
export async function getChatroomLabel(
  chatroomId: string,
  viewerId: string
): Promise<string> {
  const { data: room } = await supabaseAdmin
    .from("chatrooms")
    .select("name")
    .eq("id", chatroomId)
    .maybeSingle();
 
  if (room?.name) return room.name; // custom name wins
 
  const { data: members } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id")
    .eq("chatroom_id", chatroomId);
 
  const memberIds = (members ?? []).map((m) => m.clerk_user_id);
  const otherIds = memberIds.filter((id) => id !== viewerId);
  if (otherIds.length === 0) return "Group chat";
 
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, display_name")
    .in("clerk_user_id", otherIds);
 
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.display_name ?? "Unknown"])
  );
  const names = otherIds.map((id) => nameById.get(id) ?? "Unknown");
 
  if (memberIds.length === 2) return names[0]; // 1:1
 
  // Group: up to 3 names, ellipsis if more.
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown}…` : shown;
}

// Adds is_admin per member and a viewerIsAdmin flag for the UI.
export async function getChatroomMembers(
  chatroomId: string,
  requesterId: string
): Promise<{
  viewerIsAdmin: boolean;
  members: {
    clerkUserId: string;
    displayName: string;
    isAdmin: boolean;
    addedBy: string | null;
  }[];
}> {
  if (!(await isChatroomMember(chatroomId, requesterId))) {
    return { viewerIsAdmin: false, members: [] };
  }
 
  const { data: rows } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id, is_admin, added_by, joined_at")
    .eq("chatroom_id", chatroomId)
    .order("joined_at", { ascending: true });
 
  const ids = (rows ?? []).map((m) => m.clerk_user_id);
  if (ids.length === 0) return { viewerIsAdmin: false, members: [] };
 
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, display_name")
    .in("clerk_user_id", ids);
 
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.display_name ?? "Unknown"])
  );
 
  const members = (rows ?? []).map((m) => ({
    clerkUserId: m.clerk_user_id,
    displayName: nameById.get(m.clerk_user_id) ?? "Unknown",
    isAdmin: m.is_admin === true,
    addedBy: m.added_by ?? null,
  }));
 
  const viewerIsAdmin =
    members.find((m) => m.clerkUserId === requesterId)?.isAdmin === true;
 
  return { viewerIsAdmin, members };
}
 
// Inserts a system message into a room (no sender). Broadcast live via Realtime.
export async function postSystemMessage(
  chatroomId: string,
  content: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("messages")
    .insert({ chatroom_id: chatroomId, sender_id: null, type: "system", content });
  if (error) console.error("postSystemMessage failed:", error);
}
 
// Renames a room. Any member may rename. Empty/blank name clears it (reverts to auto).
export async function renameChatroom(
  chatroomId: string,
  requesterId: string,
  newName: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!(await isChatroomMember(chatroomId, requesterId))) {
    return { ok: false, reason: "not a member" };
  }
  const trimmed = newName.trim();
  const value = trimmed.length === 0 ? null : trimmed.slice(0, 100);
 
  const { error } = await supabaseAdmin
    .from("chatrooms")
    .update({ name: value })
    .eq("id", chatroomId);
 
  if (error) {
    console.error("renameChatroom failed:", error);
    return { ok: false, reason: "update failed" };
  }
  return { ok: true };
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
 
  const pairKey = [match.initiator_id, match.recipient_id].sort().join(":");

  const { data: room, error: roomErr } = await supabaseAdmin
    .from("chatrooms")
    .insert({ name: null, pair_key: pairKey })
    .select("id")
    .single();

  if (roomErr) {
    const { data: existing } = await supabaseAdmin
      .from("chatrooms")
      .select("id")
      .eq("pair_key", pairKey)
      .maybeSingle();
    if (existing) return existing.id;
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
  if (!(await isChatroomAdmin(chatroomId, requesterId))) return [];

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
    return { ok: false, reason: "only an admin can add members" };
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

  if (memberIds.length === 2) {
    await supabaseAdmin
      .from("chatroom_members")
      .update({ is_admin: true })
      .eq("chatroom_id", chatroomId)
      .in("clerk_user_id", memberIds);
  }

  const { data: names } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, display_name")
    .in("clerk_user_id", [requesterId, targetId]);
  const nm = new Map((names ?? []).map((p) => [p.clerk_user_id, p.display_name ?? "Someone"]));
  await postSystemMessage(
    chatroomId,
    `${nm.get(targetId) ?? "Someone"} was added by ${nm.get(requesterId) ?? "someone"}`
  );

  return { ok: true };
}

// True if the user is an admin of the room. Fails closed on error.
export async function isChatroomAdmin(
  chatroomId: string,
  clerkUserId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("chatroom_members")
    .select("is_admin")
    .eq("chatroom_id", chatroomId)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
 
  if (error) {
    console.error("isChatroomAdmin lookup failed:", error);
    return false;
  }
  return data?.is_admin === true;
}
 
/**
 * If a room has no admin left, promote the oldest remaining member
 * (earliest joined_at). Safe to call after any removal/leave.
 */
async function ensureRoomHasAdmin(chatroomId: string): Promise<void> {
  const { data: members } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id, is_admin, joined_at")
    .eq("chatroom_id", chatroomId)
    .order("joined_at", { ascending: true });
 
  const rows = members ?? [];
  if (rows.length === 0) return;                 // empty room, nothing to do
  if (rows.some((m) => m.is_admin)) return;      // an admin already exists
 
  // Promote the oldest member.
  const oldest = rows[0];
  await supabaseAdmin
    .from("chatroom_members")
    .update({ is_admin: true })
    .eq("chatroom_id", chatroomId)
    .eq("clerk_user_id", oldest.clerk_user_id);
}
 
/**
 * Removes a member from a room. Only an admin may remove someone, and only
 * someone who isn't themselves (use leaveChatroom to remove yourself).
 * After removal, ensures the room still has an admin.
 */
export async function removeMember(
  chatroomId: string,
  requesterId: string,
  targetId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!(await isChatroomAdmin(chatroomId, requesterId))) {
    return { ok: false, reason: "only an admin can remove members" };
  }
  if (requesterId === targetId) {
    return { ok: false, reason: "use leave to remove yourself" };
  }
  if (!(await isChatroomMember(chatroomId, targetId))) {
    return { ok: false, reason: "target is not a member" };
  }
 
  const { error } = await supabaseAdmin
    .from("chatroom_members")
    .delete()
    .eq("chatroom_id", chatroomId)
    .eq("clerk_user_id", targetId);
 
  if (error) {
    console.error("removeMember failed:", error);
    return { ok: false, reason: "delete failed" };
  }
 
  await ensureRoomHasAdmin(chatroomId); // in case we removed the last admin
  return { ok: true };
}
 
/**
 * The current user leaves a room (deletes their own membership). If they were
 * the last admin, the oldest remaining member is auto-promoted.
 */
export async function leaveChatroom(
  chatroomId: string,
  clerkUserId: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!(await isChatroomMember(chatroomId, clerkUserId))) {
    return { ok: false, reason: "not a member" };
  }
 
  const { error } = await supabaseAdmin
    .from("chatroom_members")
    .delete()
    .eq("chatroom_id", chatroomId)
    .eq("clerk_user_id", clerkUserId);
 
  if (error) {
    console.error("leaveChatroom failed:", error);
    return { ok: false, reason: "delete failed" };
  }
 
  await ensureRoomHasAdmin(chatroomId);
  return { ok: true };
}