import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCandidates, getIncomingRequests } from "@/lib/supabase/candidates";
import { rankCandidates, type ScoringUser } from "@/lib/matching";
import { getPhotoUrls } from "@/lib/photos";
import { MatchFeed } from "./match-feed";

export default async function MatchPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  // 1. Fetch the current user WITH preferences + gyms + availability (ScoringUser).
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  const { data: userGymLinks } = await supabaseAdmin
    .from("user_gyms")
    .select("gyms ( id, name, chain, latitude, longitude )")
    .eq("clerk_user_id", userId);
  const { data: userAvail } = await supabaseAdmin
    .from("availability")
    .select("day_of_week, time_of_day")
    .eq("clerk_user_id", userId);
  
    // All ActiveSG gyms with coordinates — for the proximity fallback in scoring.
  const { data: activeSgRows } = await supabaseAdmin
    .from("gyms")
    .select("id, name, chain, latitude, longitude")
    .eq("chain", "ActiveSG")
    .not("latitude", "is", null);
  const activeSgGyms = activeSgRows ?? [];

  const user: ScoringUser = {
    clerk_user_id: profile.clerk_user_id,
    display_name: profile.display_name,
    age: profile.age,
    experience: profile.experience,
    gender: profile.gender,
    bio: profile.bio,
    workout_style: profile.workout_style,
    photo_path: profile.photo_path,
    gyms: (userGymLinks ?? []).map((l: any) => l.gyms).filter(Boolean),
    availability: (userAvail ?? []).map((a) => ({ day: a.day_of_week, time: a.time_of_day })),
    preferred_experience: profile.preferred_experience ?? [],
    preferred_gender: profile.preferred_gender ?? [],
    preferred_styles: profile.preferred_styles ?? [],
    match_radius_km: profile.match_radius_km ?? 5,
  };

  // 2. Get eligible candidates and rank them.
  const candidates = await getCandidates(userId);
  const ranked = rankCandidates(user, candidates, {
  activeSgGyms,
  radiusKm: user.match_radius_km,
});

  // 3. Batch-sign candidate photos (one call), attach a viewable URL to each.
  const photoPaths = candidates
    .map((c) => c.photo_path)
    .filter((p): p is string => !!p);
  const photoMap = await getPhotoUrls(photoPaths);

  const cards = ranked.map((r) => ({
    ...r,
    photoUrl: r.candidate.photo_path ? photoMap.get(r.candidate.photo_path) ?? null : null,
  }));

  // 4. Incoming pending requests (people who liked you), with signed photos.
  const requests = await getIncomingRequests(userId);
  const reqPhotoPaths = requests
    .map((r) => r.requester!.photo_path)
    .filter((p): p is string => !!p);
  const reqPhotoMap = await getPhotoUrls(reqPhotoPaths);

  const requestCards = requests.map((r) => ({
    matchId: r.matchId,
    requester: r.requester!,
    photoUrl: r.requester!.photo_path ? reqPhotoMap.get(r.requester!.photo_path) ?? null : null,
  }));


  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">Find a match</h1>
      <MatchFeed
        cards={cards}
        requestCards={requestCards}
        userAvailability={user.availability}
      />
    </main>
  );
}