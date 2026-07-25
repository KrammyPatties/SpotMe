import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getRatingTarget } from "@/lib/supabase/ratings";
import RatingForm from "./rating-form";
import { getPendingRating } from "@/lib/supabase/ratings";

// Server component: authenticates and resolves the rating target.
// getRatingTarget returns null unless the session exists, has completed, the
// user is a member, and they still owe at least one rating — so it doubles as
// this page's authorisation check.

export default async function RateSessionPage({
  params,
}: {
  params: Promise<{ chatroomId: string; sessionId: string }>;
}) {
  const { chatroomId, sessionId } = await params;

  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) redirect("/");

  const target = await getRatingTarget(sessionId, userId);
  if (!target || target.chatroomId !== chatroomId) {
    redirect(`/messages/${chatroomId}`);
  }

  return <RatingForm target={target} />;
}
