import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import {
  getModerationQueue,
  getFlaggedUsers,
  getActionLog,
  getDashboardStats,
  getReviewsForUsers,
} from "@/lib/supabase/moderation";
import { AdminTabs } from "./admin-tabs";

export default async function AdminPage() {
  const { userId } = await auth();

  if (!isAdmin(userId)) notFound();

  const [stats, queue, flagged, actionLog] = await Promise.all([
    getDashboardStats(),
    getModerationQueue(),
    getFlaggedUsers(),
    getActionLog(),
  ]);

  const reviews = flagged.ok
    ? await getReviewsForUsers(flagged.value.map((f) => f.clerkUserId))
    : new Map();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 pb-32">
      <h1 className="text-3xl font-bold">Moderation</h1>
      <p className="mt-1 text-ink/70">
        Reports, rating flags, and the action log.
      </p>

      <AdminTabs
        stats={stats}
        reports={queue.ok ? queue.value : []}
        reportsError={queue.ok ? null : queue.error}
        flagged={flagged.ok ? flagged.value : []}
        flaggedError={flagged.ok ? null : flagged.error}
        reviews={Object.fromEntries(reviews)}
        actionLog={actionLog}
      />
    </main>
  );
}