import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAddableUsers } from "@/lib/chat";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chatroomId = new URL(req.url).searchParams.get("chatroom_id");
  if (!chatroomId || !UUID_RE.test(chatroomId)) {
    return NextResponse.json(
      { error: "chatroom_id query param must be a valid uuid" },
      { status: 400 }
    );
  }

  // getAddableUsers already checks the requester is a member (returns [] if not).
  const users = await getAddableUsers(chatroomId, userId);
  return NextResponse.json({ users });
}