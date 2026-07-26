import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isChatroomMember } from "@/lib/chat";
import { UUID_RE } from "@/lib/uuid";
import { assertNotSuspended } from "@/lib/moderation-guard";

const MAX_CONTENT_LENGTH = 2000;

export async function POST(req: Request) {
  // 1. Authentication.
  const { isAuthenticated, userId } = await auth();
  if (!isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const suspended = await assertNotSuspended(userId);
  if (suspended) return suspended;

  // 2. Parse and validate input before touching the database.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { chatroom_id, content, client_msg_id } = (body ?? {}) as {
    chatroom_id?: unknown;
    content?: unknown;
    client_msg_id?: unknown;
  };

  if (typeof chatroom_id !== "string" || !UUID_RE.test(chatroom_id)) {
    return NextResponse.json(
      { error: "chatroom_id must be a valid uuid" },
      { status: 400 }
    );
  }

  if (typeof content !== "string") {
    return NextResponse.json(
      { error: "content must be a string" },
      { status: 400 }
    );
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "content must not be empty" },
      { status: 400 }
    );
  }
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `content must be at most ${MAX_CONTENT_LENGTH} characters` },
      { status: 400 }
    );
  }

  if (
    client_msg_id !== undefined &&
    (typeof client_msg_id !== "string" ||
      client_msg_id.length < 1 ||
      client_msg_id.length > 64)
  ) {
    return NextResponse.json(
      { error: "client_msg_id must be a string of 1-64 characters" },
      { status: 400 }
    );
  }

  // 3. Authorisation checks sender must belong to the chatroom.
  const member = await isChatroomMember(chatroom_id, userId);
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 4. Insert via the service-role server client.
  //    Realtime broadcasts this insert to subscribed clients automatically.
  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      chatroom_id,
      sender_id: userId,
      content: trimmed,
      client_msg_id: client_msg_id ?? null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Message already sent" },
        { status: 409 }
      );
    }
    console.error("message insert failed:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }

  return NextResponse.json({ message: data }, { status: 201 });
}