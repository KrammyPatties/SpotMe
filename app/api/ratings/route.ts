import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isChatroomMember } from "@/lib/chat";
import { validateRatingSubmission } from "@/lib/ratings";

// app/api/ratings/route.ts
//
// Submit ratings for the other members of a completed session. One request
// carries the whole form: several ratees, one session.

export async function POST(req: Request) {
  // 1. Authentication.
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse and validate before touching the database.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // raterId comes from the session, so self-rating is caught in validation.
  const result = validateRatingSubmission(body, userId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { session_id, ratings } = result.value;

  // 3. The session must exist and must have actually happened.
  const { data: session, error: fetchError } = await supabaseAdmin
    .from("scheduled_sessions")
    .select("id, chatroom_id, status")
    .eq("id", session_id)
    .maybeSingle();

  if (fetchError) {
    console.error("session fetch failed:", fetchError);
    return NextResponse.json(
      { error: "Failed to submit ratings" },
      { status: 500 }
    );
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status !== "completed") {
    return NextResponse.json(
      { error: "You can only rate a completed session" },
      { status: 409 }
    );
  }

  // 4. Authorisation: the rater must belong to the session's room. Same helper
  //    the send endpoint and the chatroom page use.
  const member = await isChatroomMember(session.chatroom_id, userId);
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 5. Every ratee must belong to that room too — otherwise a member could
  //    rate an arbitrary stranger by passing their Clerk ID.
  const { data: members, error: membersError } = await supabaseAdmin
    .from("chatroom_members")
    .select("clerk_user_id")
    .eq("chatroom_id", session.chatroom_id);

  if (membersError) {
    console.error("member fetch failed:", membersError);
    return NextResponse.json(
      { error: "Failed to submit ratings" },
      { status: 500 }
    );
  }

  const memberIds = new Set((members ?? []).map((m) => m.clerk_user_id));
  const strangers = ratings.filter((r) => !memberIds.has(r.ratee_id));
  if (strangers.length) {
    return NextResponse.json(
      { error: "You can only rate people who were in the session" },
      { status: 400 }
    );
  }

  // 6. Insert. A single multi-row insert is atomic in Postgres, so a duplicate
  //    on any row rejects the whole submission — a half-saved rating form is
  //    worse than a clean retry.
  const rows = ratings.map((r) => ({
    session_id,
    rater_id: userId, // from the session, never the body
    ratee_id: r.ratee_id,
    score: r.score,
    review: r.review,
  }));

  const { data, error: insertError } = await supabaseAdmin
    .from("ratings")
    .insert(rows)
    .select();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "You've already rated this session" },
        { status: 409 }
      );
    }
    console.error("rating insert failed:", insertError);
    return NextResponse.json(
      { error: "Failed to submit ratings" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ratings: data }, { status: 201 });
}
