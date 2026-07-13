import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  seedProfile,
  seedChatroom,
  seedMember,
  cleanup,
} from "./helpers";


// Use a mock auth() to allow for test-only functionality.
const { currentAuthRef, testDb } = vi.hoisted(() => {
  const { createClient } = require("@supabase/supabase-js");
  const url = process.env.SUPABASE_TEST_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_TEST_URL or SUPABASE_TEST_SERVICE_ROLE_KEY. " +
        "Integration tests require a dedicated Supabase test project."
    );
  }
  return {
    // A mutable holder so individual tests can change the simulated identity.
    currentAuthRef: { value: { isAuthenticated: false, userId: null as string | null } },
    testDb: createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve(currentAuthRef.value),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: testDb,
}));

// Import the route AFTER the mocks are registered.
import { POST } from "../route";

// Test fixtures.
const MEMBER_ID = "test_user_member";
const NONMEMBER_ID = "test_user_nonmember";

let db: SupabaseClient = testDb;
let roomId: string;

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await seedProfile(db, MEMBER_ID, "Member User");
  await seedProfile(db, NONMEMBER_ID, "Non-member User");
  roomId = await seedChatroom(db);
  await seedMember(db, roomId, MEMBER_ID); // MEMBER_ID is in the room, NONMEMBER is not
});

afterAll(async () => {
  await cleanup(db, [roomId], [MEMBER_ID, NONMEMBER_ID]);
});

beforeEach(() => {
  // Default to signed-out, each test opts into an identity.
  currentAuthRef.value = { isAuthenticated: false, userId: null };
});

describe("POST /api/messages", () => {
  it("401 when the request is not authenticated", async () => {
    currentAuthRef.value = { isAuthenticated: false, userId: null };
    const res = await POST(postRequest({ chatroom_id: roomId, content: "hi" }));
    expect(res.status).toBe(401);
  });

  it("403 when a signed-in user is not a member of the room", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: NONMEMBER_ID };
    const res = await POST(postRequest({ chatroom_id: roomId, content: "hi" }));
    expect(res.status).toBe(403);
  });

  it("400 when content is empty", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: MEMBER_ID };
    const res = await POST(postRequest({ chatroom_id: roomId, content: "   " }));
    expect(res.status).toBe(400);
  });

  it("400 when chatroom_id is not a valid uuid", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: MEMBER_ID };
    const res = await POST(postRequest({ chatroom_id: "not-a-uuid", content: "hi" }));
    expect(res.status).toBe(400);
  });

  it("201 and persists the row when a member sends valid content", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: MEMBER_ID };
    const content = `hello ${Date.now()}`;

    const res = await POST(postRequest({ chatroom_id: roomId, content }));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.message).toBeTruthy();
    expect(json.message.content).toBe(content);
    expect(json.message.sender_id).toBe(MEMBER_ID); // sender comes from auth, not body

    // Confirm it actually landed in the DB.
    const { data, error } = await db
      .from("messages")
      .select("id, sender_id, content, chatroom_id")
      .eq("id", json.message.id)
      .single();

    expect(error).toBeNull();
    expect(data?.content).toBe(content);
    expect(data?.chatroom_id).toBe(roomId);
  });

  it("ignores a spoofed sender_id in the body (uses the session identity)", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: MEMBER_ID };
    const content = `spoof check ${Date.now()}`;

    const res = await POST(
      postRequest({
        chatroom_id: roomId,
        content,
        sender_id: NONMEMBER_ID,
      })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.message.sender_id).toBe(MEMBER_ID); // not NONMEMBER_ID
  });
});