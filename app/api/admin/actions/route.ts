import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { validateModerationAction } from "@/lib/moderation";

export async function POST(req: Request) {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validated = validateModerationAction(body, userId);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { target_user_id, action, reason, expires_at, report_id } =
    validated.value;

  const { data: target, error: targetError } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id")
    .eq("clerk_user_id", target_user_id)
    .maybeSingle();

  if (targetError) {
    console.error("target lookup failed:", targetError);
    return NextResponse.json({ error: "Failed to act" }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("moderation_actions")
    .insert({
      target_user_id,
      admin_id: userId,
      action,
      reason,
      expires_at,
      report_id,
    })
    .select()
    .single();

  if (error) {
    console.error("moderation action insert failed:", error);
    return NextResponse.json({ error: "Failed to act" }, { status: 500 });
  }

  return NextResponse.json({ action: data }, { status: 201 });
}