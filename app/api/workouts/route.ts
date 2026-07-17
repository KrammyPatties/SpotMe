import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { validateWorkoutPayload, toStartCase } from "@/lib/workouts/validate";

export async function POST(request: Request) {
  // 1. Auth - user id from the session, never the body.
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse + validate
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const result = validateWorkoutPayload(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const { performed_on, notes, exercises } = result.value;

  // 3. Insert the session
  const { data: session, error: sessionError } = await supabaseAdmin
    .from("workout_sessions")
    .insert({ clerk_user_id: userId, performed_on, notes })
    .select("id")
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Could not create session." }, { status: 500 });
  }

  // 4. Flatten exercises -> set rows. Both indices are assigned server-side,
  //    never taken from the body: exercise_index is the block's position in
  //    the session, set_index the set's position within that block.
  //    exercise_name is normalised to Start Case so the same exercise typed
  //    with different casing ("bench press" / "Bench Press") matches as one.
  const setRows = exercises.flatMap((ex, exIdx) =>
    ex.sets.map((set, idx) => ({
      session_id: session.id,
      exercise_name: toStartCase(ex.exercise_name),
      exercise_index: exIdx + 1,
      set_index: idx + 1,
      reps: set.reps,
      weight_kg: set.weight_kg,
    }))
  );

  const { error: setsError } = await supabaseAdmin
    .from("workout_sets")
    .insert(setRows);

  // 5. If sets fail, clean up the orphaned session (no half-saved workouts).
  if (setsError) {
    await supabaseAdmin.from("workout_sessions").delete().eq("id", session.id);
    return NextResponse.json({ error: "Could not save sets." }, { status: 500 });
  }

  return NextResponse.json({ id: session.id }, { status: 201 });
}