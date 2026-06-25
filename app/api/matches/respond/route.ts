import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { matchId, action } = await req.json();
  if (!["accept", "decline"].includes(action) || typeof matchId !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const newStatus = action === "accept" ? "accepted" : "declined";

  // Security: only the RECIPIENT of a pending request can respond to it.
  const { error } = await supabaseAdmin
    .from("matches")
    .update({ status: newStatus, responded_at: new Date().toISOString() })
    .eq("id", matchId)
    .eq("recipient_id", userId)     // can only respond to requests sent TO you
    .eq("status", "pending");       // can only respond to still-pending ones

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}