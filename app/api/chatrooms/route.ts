import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createGroupChat } from "@/lib/chat";

/**
 * POST /api/chatrooms
 * Creates a group chat. Body: { name: string, member_ids: string[] }.
 * The creator is the signed-in user and every member_id must be their accepted match.
 */
export async function POST(req: Request) {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { name, member_ids } = (body ?? {}) as {
    name?: unknown;
    member_ids?: unknown;
  };

  if (typeof name !== "string") {
    return NextResponse.json({ error: "name must be a string" }, { status: 400 });
  }
  if (
    !Array.isArray(member_ids) ||
    !member_ids.every((id) => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: "member_ids must be an array of strings" },
      { status: 400 }
    );
  }

  const result = await createGroupChat(userId, name, member_ids);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ chatroomId: result.chatroomId }, { status: 201 });
}