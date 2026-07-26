import { NextResponse } from "next/server";
import { getModerationStatus } from "@/lib/supabase/moderation";


// Block a suspended user from acting.
export async function assertNotSuspended(
  userId: string
): Promise<NextResponse | null> {
  const status = await getModerationStatus(userId);

  if (status !== "suspended") return null;

  return NextResponse.json(
    { error: "Your account is suspended and cannot perform this action." },
    { status: 403 }
  );
}