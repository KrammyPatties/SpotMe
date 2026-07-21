import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getAcceptedMatchProfiles } from "@/lib/chat";

/**
 * GET /api/matches/accepted
 * Returns the signed-in user's accepted matches as pickable options
 * for group creation: [{ clerkUserId, displayName }].
 */
export async function GET() {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const matches = await getAcceptedMatchProfiles(userId);
  return NextResponse.json({ matches });
}