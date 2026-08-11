import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isChatroomMember } from "@/lib/chat";
import { validateSessionProposal } from "@/lib/scheduling";
import { assertNotSuspended } from "@/lib/moderation-guard";

export async function POST(req: Request) {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const suspended = await assertNotSuspended(userId);
  if (suspended) return suspended;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = validateSessionProposal(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { chatroom_id, starts_at, ends_at, gym_id } = result.value;

  const member = await isChatroomMember(chatroom_id, userId);
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin
    .from("scheduled_sessions")
    .insert({ chatroom_id, proposer_id: userId, gym_id, starts_at, ends_at })
    .select()
    .single();

if (error) {
    console.error("session insert failed:", error);
    return NextResponse.json(
      { error: "Failed to propose session" },
      { status: 500 }
    );
  }

  const { error: confirmError } = await supabaseAdmin
    .from("session_confirmations")
    .insert({ session_id: data.id, user_id: userId, status: "going" });

  if (confirmError) {
    console.error("proposer confirmation insert failed:", confirmError);
    await supabaseAdmin.from("scheduled_sessions").delete().eq("id", data.id);
    return NextResponse.json(
      { error: "Failed to propose session" },
      { status: 500 }
    );
  }

  return NextResponse.json({ session: data }, { status: 201 });
}