import { supabaseAdmin } from "@/lib/supabase/server";

// A candidate is an eligible potential match, with everything scoring algo needs.
export type Candidate = {
  clerk_user_id: string;
  display_name: string;
  age: number | null;
  experience: string;
  gender: string | null;
  bio: string | null;
  workout_style: string | null;
  gyms: { id: string; name: string; chain: string; latitude: number | null; longitude: number | null }[];
  availability: { day: number; time: string }[];
};

// Returns the pool of users eligible to be shown to `userId` as potential matches.
export async function getCandidates(userId: string): Promise<Candidate[]> {
  // 1. Find everyone the user is already entangled with (pending/accepted, either direction).
  const { data: existingMatches, error: matchErr } = await supabaseAdmin
    .from("matches")
    .select("initiator_id, recipient_id, status")
    .or(`initiator_id.eq.${userId},recipient_id.eq.${userId}`)
    .in("status", ["pending", "accepted"]);

  if (matchErr) throw new Error(`Failed to load matches: ${matchErr.message}`);

  // The "other" person in each match is the one to exclude.
  const excludedIds = new Set<string>([userId]); // exclude self
  for (const m of existingMatches ?? []) {
    excludedIds.add(m.initiator_id === userId ? m.recipient_id : m.initiator_id);
  }

  // 2. Fetch the eligible profiles (flat, no joins).
  const { data: profiles, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("clerk_user_id, display_name, age, experience, gender, bio, workout_style")
    .not("clerk_user_id", "in", `(${[...excludedIds].join(",")})`);

  if (profErr) throw new Error(`Failed to load candidates: ${profErr.message}`);

  const candidateIds = (profiles ?? []).map((p) => p.clerk_user_id);
  if (candidateIds.length === 0) return [];

  // 3. Fetch gyms for all candidates in one query (junction joined to gyms).
  //    Embedding user_gyms -> gyms in ONE direction (single FK) is reliable,
  //    unlike the two-hop profiles -> user_gyms -> gyms that failed.
  const { data: gymLinks, error: gymErr } = await supabaseAdmin
    .from("user_gyms")
    .select("clerk_user_id, gyms ( id, name, chain, latitude, longitude )")
    .in("clerk_user_id", candidateIds);

  if (gymErr) throw new Error(`Failed to load candidate gyms: ${gymErr.message}`);

  // 4. Fetch availability for all candidates in one query.
  const { data: avail, error: availErr } = await supabaseAdmin
    .from("availability")
    .select("clerk_user_id, day_of_week, time_of_day")
    .in("clerk_user_id", candidateIds);

  if (availErr) throw new Error(`Failed to load candidate availability: ${availErr.message}`);

  // 5. Assemble: group gyms and availability by user, then attach to each profile.
  const gymsByUser = new Map<string, Candidate["gyms"]>();
  for (const link of gymLinks ?? []) {
    const list = gymsByUser.get(link.clerk_user_id) ?? [];
    if (link.gyms) list.push(link.gyms as any);
    gymsByUser.set(link.clerk_user_id, list);
  }

  const availByUser = new Map<string, Candidate["availability"]>();
  for (const a of avail ?? []) {
    const list = availByUser.get(a.clerk_user_id) ?? [];
    list.push({ day: a.day_of_week, time: a.time_of_day });
    availByUser.set(a.clerk_user_id, list);
  }

  return (profiles ?? []).map((p) => ({
    clerk_user_id: p.clerk_user_id,
    display_name: p.display_name,
    age: p.age,
    experience: p.experience,
    gender: p.gender,
    bio: p.bio,
    workout_style: p.workout_style,
    gyms: gymsByUser.get(p.clerk_user_id) ?? [],
    availability: availByUser.get(p.clerk_user_id) ?? [],
  }));
}