import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function POST(req: Request) {
  // Confirm the caller is signed in.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Read the submitted fields.
  const body = await req.json();
  const { display_name, age, experience, gender, bio, gym_ids } = body;

  if (!display_name || typeof display_name !== "string") {
    return NextResponse.json({ error: "Display name is required" }, { status: 400 });
  }

  // Write profile row (keyed by the Clerk user ID).
  const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
    clerk_user_id: userId,
    display_name,
    age: age ?? null,
    experience: experience ?? "beginner",
    gender: gender ?? null,
    bio: bio ?? null,
    updated_at: new Date().toISOString(),
  });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  // Replace user gym links.
  await supabaseAdmin.from("user_gyms").delete().eq("clerk_user_id", userId);

  if (Array.isArray(gym_ids) && gym_ids.length > 0) {
    const rows = gym_ids.map((gym_id: string) => ({ clerk_user_id: userId, gym_id }));
    const { error: gymError } = await supabaseAdmin.from("user_gyms").insert(rows);
    if (gymError) {
      return NextResponse.json({ error: gymError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}