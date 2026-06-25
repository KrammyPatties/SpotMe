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

  // Create a pending match. The unique(initiator_id, recipient_id) constraint
  // plus this check prevent duplicate requests.
  const { error } = await supabaseAdmin.from("matches").insert({
    initiator_id: userId,
    recipient_id: recipientId,
    status: "pending",
  });

  if (error) {
    // 23505 = unique violation (request already exists this direction).
    if (error.code === "23505") {
      return NextResponse.json({ error: "Already requested" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}