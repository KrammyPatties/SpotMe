import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isChatroomMember } from "@/lib/chat";
import { isUuid } from "@/lib/uuid";

const ACTIONS = ["confirm", "cancel"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: Request) {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { session_id, action } = (body ?? {}) as {
    session_id?: unknown;
    action?: unknown;
  };

  if (typeof session_id !== "string" || !isUuid(session_id)) {
    return NextResponse.json(
      { error: "session_id must be a valid uuid" },
      { status: 400 }
    );
  }

  if (!ACTIONS.includes(action as Action)) {
    return NextResponse.json(
      { error: "action must be 'confirm' or 'cancel'" },
      { status: 400 }
    );
  }

  const { data: session, error: fetchError } = await supabaseAdmin
    .from("scheduled_sessions")
    .select("id, chatroom_id, proposer_id, status")
    .eq("id", session_id)
    .maybeSingle();

  if (fetchError) {
    console.error("session fetch failed:", fetchError);
    return NextResponse.json({ error: "Failed to respond" }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const member = await isChatroomMember(session.chatroom_id, userId);
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (action === "confirm" && session.proposer_id === userId) {
    return NextResponse.json(
      { error: "You cannot confirm your own proposal" },
      { status: 403 }
    );
  }

  const nextStatus = action === "confirm" ? "confirmed" : "cancelled";

  const { data, error } = await supabaseAdmin
    .from("scheduled_sessions")
    .update({ status: nextStatus, responded_at: new Date().toISOString() })
    .eq("id", session_id)
    .eq("status", "proposed")
    .select()
    .maybeSingle();

  if (error) {
    console.error("session update failed:", error);
    return NextResponse.json({ error: "Failed to respond" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Session is no longer awaiting a response" },
      { status: 409 }
    );
  }

  return NextResponse.json({ session: data }, { status: 200 });
}