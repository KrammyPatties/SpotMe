import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  // Who is signed in? (runs on the server)
  const { userId } = await auth();
  if (!userId) redirect("/");

  // If they already have a profile, no need to onboard again.
  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (existing) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>You already have a profile ✅</h1>
        <p>Your Clerk user ID: {userId}</p>
      </div>
    );
  }

  // Load gyms for the picker.
  const { data: gyms } = await supabaseAdmin
    .from("gyms")
    .select("id, name, outlet, region")
    .order("name");

  return (
    <div style={{ padding: "2rem", maxWidth: 500 }}>
      <h1>Create your profile</h1>
      <OnboardingForm gyms={gyms ?? []} />
    </div>
  );
}