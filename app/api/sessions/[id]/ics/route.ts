import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isChatroomMember } from "@/lib/chat";
import { isUuid } from "@/lib/uuid";
import { buildIcs } from "@/lib/scheduling";
import { getConfirmations } from "@/lib/supabase/sessions";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isUuid(id)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const { data: session, error } = await supabaseAdmin
    .from("scheduled_sessions")
    .select("id, chatroom_id, gym_id, starts_at, ends_at, status, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("session fetch failed:", error);
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const member = await isChatroomMember(session.chatroom_id, userId);
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (session.status !== "confirmed") {
    return NextResponse.json(
      { error: "Only confirmed sessions can be added to a calendar" },
      { status: 409 }
    );
  }

  const confirmations = await getConfirmations(session.id);
  const attending = confirmations.some(
    (c) => c.user_id === userId && c.status === "going"
  );
  if (!attending) {
    return NextResponse.json({ error: "not attending" }, { status: 403 });
  }

  // Batched, never a nested join.
  const { data: others } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id")
    .eq("chatroom_id", session.chatroom_id)
    .neq("clerk_user_id", userId);

  const otherIds = (others ?? []).map((m) => m.clerk_user_id);

  const { data: profiles } = otherIds.length
    ? await supabaseAdmin
        .from("profiles")
        .select("display_name")
        .in("clerk_user_id", otherIds)
    : { data: [] };

  const names = (profiles ?? []).map((p) => p.display_name);
  const summary = names.length
    ? `Workout with ${names.join(", ")}`
    : "SpotMe workout session";

  let location: string | undefined;
  if (session.gym_id) {
    const { data: gym } = await supabaseAdmin
      .from("gyms")
      .select("name")
      .eq("id", session.gym_id)
      .maybeSingle();
    location = gym?.name ?? undefined;
  }

  const ics = buildIcs({
    uid: session.id,
    starts_at: session.starts_at,
    ends_at: session.ends_at,
    summary,
    location,
    description: "Scheduled via SpotMe — https://spotme-phi.vercel.app",
    created_at: session.created_at,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="spotme-session-${session.id.slice(0, 8)}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}