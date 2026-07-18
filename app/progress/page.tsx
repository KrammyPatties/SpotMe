import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getWorkoutSessions } from "@/lib/supabase/workouts";
import { LogWorkout } from "./log-workout";
import { SessionCard } from "./session-card";

export default async function ProgressPage() {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated || !userId) redirect("/");

  const sessions = await getWorkoutSessions(userId);

  return (
    <main className="min-h-screen bg-cream text-ink px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Progress</h1>
        </div>

        <LogWorkout />

        <section className="mt-10">
          <h2 className="mb-4 text-lg font-semibold">History</h2>
          {sessions.length === 0 ? (
            <p className="rounded-lg border border-ink/10 bg-white/50 p-6 text-center text-ink/60">
              No workouts logged yet. Log your first one above.
            </p>
          ) : (
            <ul className="space-y-3">
              {sessions.map((session) => (
                <SessionCard key={session.id} session={session} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}