import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { removeMember } from "@/lib/chat";

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

  const { chatroom_id, target_id } = (body ?? {}) as {
    chatroom_id?: unknown;
    target_id?: unknown;
  };

  if (typeof chatroom_id !== "string" || !UUID_RE.test(chatroom_id)) {
    return NextResponse.json(
      { error: "chatroom_id must be a valid uuid" },
      { status: 400 }
    );
  }
  if (typeof target_id !== "string" || target_id.length === 0) {
    return NextResponse.json({ error: "target_id required" }, { status: 400 });
  }

  const result = await removeMember(chatroom_id, userId, target_id);
  if (!result.ok) {
    const status = result.reason?.includes("admin") ? 403 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}