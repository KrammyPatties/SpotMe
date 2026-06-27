import { SupabaseClient } from "@supabase/supabase-js";

// A profile row the test owns and cleans up.
export async function seedProfile(
  db: SupabaseClient,
  clerkUserId: string,
  displayName: string
) {
  await db
    .from("profiles")
    .upsert({ clerk_user_id: clerkUserId, display_name: displayName });
}

// Create a chatroom and return its id.
export async function seedChatroom(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from("chatrooms")
    .insert({ name: null })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedChatroom failed: ${error?.message}`);
  return data.id;
}

// Add a member to a chatroom.
export async function seedMember(
  db: SupabaseClient,
  chatroomId: string,
  clerkUserId: string
) {
  await db
    .from("chatroom_members")
    .insert({ chatroom_id: chatroomId, clerk_user_id: clerkUserId });
}

// Remove everything a test created. Deleting the chatroom cascades to its
// members and messages (FKs are ON DELETE CASCADE), so we only need to
// delete rooms and the profiles we seeded.
export async function cleanup(
  db: SupabaseClient,
  chatroomIds: string[],
  clerkUserIds: string[]
) {
  if (chatroomIds.length) {
    await db.from("chatrooms").delete().in("id", chatroomIds);
  }
  if (clerkUserIds.length) {
    await db.from("profiles").delete().in("clerk_user_id", clerkUserIds);
  }
}