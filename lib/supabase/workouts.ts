import { supabaseAdmin } from "@/lib/supabase/server";

export type WorkoutSet = {
  id: string;
  exercise_name: string;
  set_index: number;
  reps: number;
  weight_kg: number;
};

export type WorkoutExercise = {
  exercise_name: string;
  sets: WorkoutSet[];
};

export type WorkoutSession = {
  id: string;
  performed_on: string; // ISO date, e.g. "2026-06-26"
  notes: string | null;
  created_at: string;
  exercises: WorkoutExercise[];
};

/**
 * Returns a user's workout sessions, newest first, each with its sets
 * grouped by exercise_name (sets ordered by set_index within an exercise).
 *
 * Batched, not a nested join: fetch sessions, then fetch all their sets in
 * one query, then assemble in JS by session_id.
 */

export async function getWorkoutSessions(
  userId: string
): Promise<WorkoutSession[]> {
  // 1. Sessions for this user, newest first.
  const { data: sessions, error: sessionsError } = await supabaseAdmin
    .from("workout_sessions")
    .select("id, performed_on, notes, created_at")
    .eq("clerk_user_id", userId)
    .order("performed_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (sessionsError) throw sessionsError;
  if (!sessions || sessions.length === 0) return [];

  // 2. All sets for those sessions, in one batched query.
  const sessionIds = sessions.map((s) => s.id);
  const { data: sets, error: setsError } = await supabaseAdmin
    .from("workout_sets")
    .select("id, session_id, exercise_name, set_index, reps, weight_kg")
    .in("session_id", sessionIds)
    .order("set_index", { ascending: true });

  if (setsError) throw setsError;

  // 3. Group sets by session_id, then by exercise_name within each session.
  const setsBySession = new Map<string, typeof sets>();
  for (const set of sets ?? []) {
    const list = setsBySession.get(set.session_id) ?? [];
    list.push(set);
    setsBySession.set(set.session_id, list);
  }

  return sessions.map((session) => {
    const sessionSets = setsBySession.get(session.id) ?? [];

    // Group by exercise_name, preserving first-seen order.
    const byExercise = new Map<string, WorkoutSet[]>();
    for (const set of sessionSets) {
      const list = byExercise.get(set.exercise_name) ?? [];
      list.push({
        id: set.id,
        exercise_name: set.exercise_name,
        set_index: set.set_index,
        reps: set.reps,
        weight_kg: set.weight_kg,
      });
      byExercise.set(set.exercise_name, list);
    }

    const exercises: WorkoutExercise[] = Array.from(byExercise.entries()).map(
      ([exercise_name, exerciseSets]) => ({ exercise_name, sets: exerciseSets })
    );

    return {
      id: session.id,
      performed_on: session.performed_on,
      notes: session.notes,
      created_at: session.created_at,
      exercises,
    };
  });
}