import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { path } = await req.json();

  // Security: the saved path MUST belong to this user's folder.
  if (typeof path !== "string" || !path.startsWith(`${userId}/`)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ photo_path: path, updated_at: new Date().toISOString() })
    .eq("clerk_user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}