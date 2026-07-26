import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { validateReportSubmission } from "@/lib/moderation";

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

  const validated = validateReportSubmission(body, userId);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { reported_id, reason } = validated.value;

  const { data: target, error: targetError } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id")
    .eq("clerk_user_id", reported_id)
    .maybeSingle();

  if (targetError) {
    console.error("report target lookup failed:", targetError);
    return NextResponse.json(
      { error: "Failed to submit report" },
      { status: 500 }
    );
  }
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("reports")
    .insert({
      reporter_id: userId,
      reported_id,
      reason,
    })
    .select("id, status, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You already have an open report against this user" },
        { status: 409 }
      );
    }
    console.error("report insert failed:", error);
    return NextResponse.json(
      { error: "Failed to submit report" },
      { status: 500 }
    );
  }

  return NextResponse.json({ report: data }, { status: 201 });
}