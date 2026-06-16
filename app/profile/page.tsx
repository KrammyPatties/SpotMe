import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { OnboardingForm } from "@/app/onboarding/onboarding-form";
import Link from "next/link";

export default async function ProfilePage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (!profile) redirect("/onboarding");

  const { data: gyms } = await supabaseAdmin
    .from("gyms")
    .select("id, name, chain, postal_code")
    .order("name");

  const { data: userGyms } = await supabaseAdmin
    .from("user_gyms")
    .select("gym_id")
    .eq("clerk_user_id", userId);

  const selectedGymIds = (userGyms ?? []).map((row) => row.gym_id);

  const { data: userAvailability } = await supabaseAdmin
  .from("availability")
  .select("day_of_week, time_of_day")
  .eq("clerk_user_id", userId);

  const availabilitySlots = (userAvailability ?? []).map((row) => ({
    day: row.day_of_week,
    time: row.time_of_day,
  }));

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-3xl font-bold">Your profile</h1>
      <p className="mt-1 text-ink/70">Edit your profile</p>

      <OnboardingForm
        gyms={gyms ?? []}
        initial={{
          display_name: profile.display_name,
          age: profile.age,
          experience: profile.experience,
          gender: profile.gender,
          bio: profile.bio,
          gym_ids: selectedGymIds,
          workout_style: profile.workout_style,
          availability: availabilitySlots,
          preferred_experience: profile.preferred_experience ?? [],
          preferred_gender: profile.preferred_gender ?? [],
          preferred_styles: profile.preferred_styles ?? [],
        }}
      />

      <Link
        href="/dashboard"
        className="mt-6 inline-block text-sm font-medium text-flame hover:underline"
      >
        Back to dashboard
      </Link>
    </main>
  );
}