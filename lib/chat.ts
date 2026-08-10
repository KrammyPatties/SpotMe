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

/**
 * The other members' photo paths for a room, in member order.
 * Companion to getChatroomLabel, the header shows both.
 */
export async function getChatroomPhotoPaths(
  chatroomId: string,
  viewerId: string
): Promise<string[]> {
  const { data: members } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id")
    .eq("chatroom_id", chatroomId);

  const otherIds = (members ?? [])
    .map((m) => m.clerk_user_id)
    .filter((id) => id !== viewerId);
  if (otherIds.length === 0) return [];

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, photo_path")
    .in("clerk_user_id", otherIds);

  const photoById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.photo_path])
  );

  return otherIds
    .map((id) => photoById.get(id))
    .filter((p): p is string => Boolean(p));
}

export async function getChatroomMemberNames(
  chatroomId: string
): Promise<Record<string, string>> {
  const { data: members, error: membersError } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id")
    .eq("chatroom_id", chatroomId);

  if (membersError || !members || members.length === 0) return {};

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, display_name")
    .in(
      "clerk_user_id",
      members.map((m) => m.clerk_user_id)
    );

  if (profilesError || !profiles) return {};

  const names: Record<string, string> = {};
  for (const p of profiles) {
    names[p.clerk_user_id] = p.display_name;
  }
  return names;
}

// Full roster of a room (for the members panel). Requester must be a member.
export async function getChatroomMembers(
  chatroomId: string,
  requesterId: string
): Promise<{ clerkUserId: string; displayName: string; addedBy: string | null }[]> {
  if (!(await isChatroomMember(chatroomId, requesterId))) return [];
 
  const { data: members } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id, added_by")
    .eq("chatroom_id", chatroomId);
 
  const ids = (members ?? []).map((m) => m.clerk_user_id);
  if (ids.length === 0) return [];
 
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, display_name")
    .in("clerk_user_id", ids);
 
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.display_name ?? "Unknown"])
  );
 
  return (members ?? []).map((m) => ({
    clerkUserId: m.clerk_user_id,
    displayName: nameById.get(m.clerk_user_id) ?? "Unknown",
    addedBy: m.added_by ?? null,
  }));
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
  photoPaths: string[];   // other members' photo paths, in member order
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
        .select("clerk_user_id, display_name, photo_path")
        .in("clerk_user_id", otherIds)
    : {
        data: [] as {
          clerk_user_id: string;
          display_name: string;
          photo_path: string | null;
        }[],
      };
 
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.display_name])
  );
  const photoById = new Map(
    (profiles ?? []).map((p) => [p.clerk_user_id, p.photo_path])
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

    const photoPaths = others
      .map((id) => photoById.get(id))
      .filter((p): p is string => Boolean(p));
    
    const last = lastByRoom.get(room.id) ?? null;
    return {
      chatroomId: room.id,
      label,
      isGroup,
      photoPaths,
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

  // Create the room then add both members.
  const { data: room, error: roomErr } = await supabaseAdmin
    .from("chatrooms")
    .insert({ name: null, pair_key: pairKey })
    .select("id")
    .single();

  if (roomErr || !room) {
    // The unique index may have rejected a duplicate so return the existing room.
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
 * The set of clerk_user_ids who are accepted matches of a single user.
 * A thin wrapper over acceptedMatchIdsForMembers for the group-creation path,
 * where membership is validated against the creator's own matches only.
 */
async function acceptedMatchIdsForUser(userId: string): Promise<Set<string>> {
  return acceptedMatchIdsForMembers([userId]);
}

/**
 * The creator's accepted matches as pickable options for group creation:
 * each accepted match resolved to { clerkUserId, displayName }.
 * Backs the GET /api/matches/accepted endpoint that feeds the member picker.
 */
export async function getAcceptedMatchProfiles(
  userId: string
): Promise<{ clerkUserId: string; displayName: string }[]> {
  const eligible = await acceptedMatchIdsForUser(userId);
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
 * Creates a named group chat with a fixed membership set at creation.
 * The creator is always a member and every other member must be an accepted
 * match of the creator. Requires a name and at least 2 other members.
 * Posts a "<name> was created" system message.
 */
export async function createGroupChat(
  creatorId: string,
  name: string,
  memberIds: string[]
): Promise<{ ok: true; chatroomId: string } | { ok: false; reason: string }> {
  // 1. Validate the name.
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return { ok: false, reason: "name required" };
  }
  const finalName = trimmedName.slice(0, 100);

  // 2. Normalise the requested members: dedupe, drop the creator if included.
  const requested = Array.from(new Set(memberIds)).filter(
    (id) => id !== creatorId
  );
  if (requested.length < 2) {
    return { ok: false, reason: "a group needs at least 2 other members" };
  }

  // 3. Authorise: every requested member must be the creator's accepted match.
  const eligible = await acceptedMatchIdsForUser(creatorId);
  for (const id of requested) {
    if (!eligible.has(id)) {
      return { ok: false, reason: "all members must be your accepted matches" };
    }
  }

  // 4. Create the room. Groups carry pair_key = null (not subject to 1:1 uniqueness).
  const { data: room, error: roomErr } = await supabaseAdmin
    .from("chatrooms")
    .insert({ name: finalName, pair_key: null })
    .select("id")
    .single();

  if (roomErr || !room) {
    console.error("createGroupChat: room insert failed:", roomErr);
    return { ok: false, reason: "could not create room" };
  }

  // 5. Insert all members: the creator plus the validated others.
  const allMemberIds = [creatorId, ...requested];
  const memberRows = allMemberIds.map((id) => ({
    chatroom_id: room.id,
    clerk_user_id: id,
    added_by: id === creatorId ? null : creatorId,
  }));

  const { error: memErr } = await supabaseAdmin
    .from("chatroom_members")
    .insert(memberRows);

  if (memErr) {
    console.error("createGroupChat: members insert failed:", memErr);
    await supabaseAdmin.from("chatrooms").delete().eq("id", room.id);
    return { ok: false, reason: "could not add members" };
  }

  // 6. Announce the room through system message.
  await postSystemMessage(room.id, `${finalName} was created`);

  return { ok: true, chatroomId: room.id };
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