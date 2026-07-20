import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { leaveChatroom } from "@/lib/chat";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { chatroom_id } = (body ?? {}) as { chatroom_id?: unknown };
  if (typeof chatroom_id !== "string" || !UUID_RE.test(chatroom_id)) {
    return NextResponse.json(
      { error: "chatroom_id must be a valid uuid" },
      { status: 400 }
    );
  }

  const result = await leaveChatroom(chatroom_id, userId);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}