import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isChatroomMember } from "@/lib/chat";
import { isUuid } from "@/lib/uuid";
import { deriveSessionStatus } from "@/lib/scheduling";
import { getConfirmations, upsertConfirmation } from "@/lib/supabase/sessions";

export async function POST(req: Request) {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { session_id, going } = (body ?? {}) as {
    session_id?: unknown;
    going?: unknown;
  };

  if (typeof session_id !== "string" || !isUuid(session_id)) {
    return NextResponse.json({ error: "invalid session_id" }, { status: 400 });
  }
  if (typeof going !== "boolean") {
    return NextResponse.json({ error: "invalid going" }, { status: 400 });
  }

  const { data: session, error: sessionError } = await supabaseAdmin
    .from("scheduled_sessions")
    .select("id, chatroom_id, proposer_id, status")
    .eq("id", session_id)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (session.status === "completed" || session.status === "cancelled") {
    return NextResponse.json(
      { error: `session is ${session.status}` },
      { status: 409 }
    );
  }

  const member = await isChatroomMember(session.chatroom_id, userId);
  if (!member) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await upsertConfirmation(session_id, userId, going ? "going" : "out");
    const confirmations = await getConfirmations(session_id);
    const nextStatus = deriveSessionStatus(session.proposer_id, confirmations);

    if (nextStatus !== session.status) {
      const { error: updateError } = await supabaseAdmin
        .from("scheduled_sessions")
        .update({ status: nextStatus, responded_at: new Date().toISOString() })
        .eq("id", session_id);

      if (updateError) throw updateError;
    }

    return NextResponse.json(
      { status: nextStatus, confirmations },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ error: "could not record attendance" }, { status: 500 });
  }
}