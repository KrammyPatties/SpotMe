import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { recipientId } = await req.json();

  if (typeof recipientId !== "string" || recipientId === userId) {
    return NextResponse.json({ error: "Invalid recipient" }, { status: 400 });
  }

  // Look for an existing request in this direction (me -> recipient).
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("matches")
    .select("id, status")
    .eq("initiator_id", userId)
    .eq("recipient_id", recipientId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }

  if (existing) {
    // Only a previously-declined request can be revived. A pending request is
    // already awaiting their response; an accepted one is a live match - both
    // are left untouched.
    if (existing.status === "declined") {
      const { error: reviveError } = await supabaseAdmin
        .from("matches")
        .update({ status: "pending", responded_at: null })
        .eq("id", existing.id);

      if (reviveError) {
        return NextResponse.json({ error: reviveError.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Already requested" }, { status: 409 });
  }

  // No existing row - create a fresh pending request.
  const { error: insertError } = await supabaseAdmin.from("matches").insert({
    initiator_id: userId,
    recipient_id: recipientId,
    status: "pending",
  });

  if (insertError) {
    // 23505 = unique violation: a concurrent request beat us to the insert.
    // Rare (two rapid likes); treat as already-requested.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "Already requested" }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}