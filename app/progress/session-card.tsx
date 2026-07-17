import type { WorkoutSession } from "@/lib/supabase/workouts";

export function SessionCard({ session }: { session: WorkoutSession }) {
  const exerciseCount = session.exercises.length;
  const setCount = session.exercises.reduce((n, ex) => n + ex.sets.length, 0);
  const date = new Date(session.performed_on).toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <li className="overflow-hidden rounded-lg border border-ink/10 bg-white/60">
      {/* Level 1: the session */}
      <details>
        <summary className="cursor-pointer list-none px-4 py-3 hover:bg-cream">
          <span className="font-semibold">{date}</span>
          <span className="ml-2 text-sm text-ink/60">
            {exerciseCount} exercise{exerciseCount !== 1 ? "s" : ""} · {setCount} set
            {setCount !== 1 ? "s" : ""}
          </span>
          {session.notes && (
            <span className="mt-1 block text-sm text-ink/70">{session.notes}</span>
          )}
        </summary>

        <div className="border-t border-ink/10 px-4 py-2">
          {/* Level 2: each exercise */}
          {session.exercises.map((ex) => (
            <details key={`${ex.exercise_index}:${ex.exercise_name}`} className="py-1">
              <summary className="cursor-pointer list-none py-1 text-sm font-medium hover:text-flame">
                {ex.exercise_name}
                <span className="ml-2 text-ink/50">
                  {ex.sets.length} set{ex.sets.length !== 1 ? "s" : ""}
                </span>
              </summary>
              <ul className="ml-4 mt-1 space-y-0.5 text-sm text-ink/80">
                {ex.sets.map((set) => (
                  <li key={set.id}>
                    Set {set.set_index}: {set.weight_kg} kg × {set.reps}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </details>
    </li>
  );
}