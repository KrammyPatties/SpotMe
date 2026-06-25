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
  const { display_name, age, experience, gender, bio, gym_ids, workout_style, 
    availability, preferred_experience, preferred_gender, preferred_styles, match_radius_km } = body;

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
    workout_style: workout_style ?? "no_preference",
		preferred_experience: preferred_experience ?? [],
    preferred_gender: preferred_gender ?? [],
    preferred_styles: preferred_styles ?? [],
    match_radius_km: match_radius_km ?? 5,
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

	// Validate workout style if provided
	const VALID_STYLES = ["powerlifting","bodybuilding","hiit","calisthenics","crossfit","general","no_preference"];
	
	if (workout_style != null && !VALID_STYLES.includes(workout_style)) {
  	return NextResponse.json({ error: "Invalid workout style" }, { status: 400 });
	}

  // Replace availability slots (same delete-all-then-insert pattern as gyms above)
	await supabaseAdmin.from("availability").delete().eq("clerk_user_id", userId);

	if (Array.isArray(availability) && availability.length > 0) {
		const rows = availability.map((s: { day: number; time: string }) => ({
			clerk_user_id: userId,
			day_of_week: s.day,
			time_of_day: s.time,
		}));
		const { error: availError } = await supabaseAdmin.from("availability").insert(rows);
		if (availError) {
			return NextResponse.json({ error: availError.message }, { status: 500 });
		}
	}

  return NextResponse.json({ ok: true });
}