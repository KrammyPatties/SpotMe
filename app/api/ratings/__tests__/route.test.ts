// Integration tests against the dedicated Supabase test project. Auth mocked,
// persistence real.

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
  seedSession,
  cleanup,
} from "../../sessions/__tests__/helpers";

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
    currentAuthRef: {
      value: { isAuthenticated: false, userId: null as string | null },
    },
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

const RATER_ID = "test_user_rater";
const RATEE_ID = "test_user_ratee";
const OUTSIDER_ID = "test_user_outsider";

const db: SupabaseClient = testDb;
let roomId: string;

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/ratings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A fresh completed session - each rating test needs its own, since the
 *  unique constraint means a session can only be rated once per pair. */
async function completedSession(): Promise<string> {
  return seedSession(db, {
    chatroomId: roomId,
    proposerId: RATER_ID,
    status: "completed",
  });
}

beforeAll(async () => {
  await seedProfile(db, RATER_ID, "Rater User");
  await seedProfile(db, RATEE_ID, "Ratee User");
  await seedProfile(db, OUTSIDER_ID, "Outsider User");
  roomId = await seedChatroom(db);
  // RATER and RATEE are in the room, OUTSIDER is not.
  await seedMember(db, roomId, RATER_ID);
  await seedMember(db, roomId, RATEE_ID);
});

afterAll(async () => {
  // ratings cascade from scheduled_sessions, which cascade from chatrooms.
  await cleanup(db, [roomId], [RATER_ID, RATEE_ID, OUTSIDER_ID]);
});

beforeEach(() => {
  currentAuthRef.value = { isAuthenticated: false, userId: null };
});

describe("POST /api/ratings", () => {
  it("401 when the request is not authenticated", async () => {
    currentAuthRef.value = { isAuthenticated: false, userId: null };
    const sessionId = await completedSession();
    const res = await POST(
      postRequest({
        session_id: sessionId,
        ratings: [{ ratee_id: RATEE_ID, score: 5 }],
      })
    );
    expect(res.status).toBe(401);
  });

  it("400 when a score is out of range", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: RATER_ID };
    const sessionId = await completedSession();
    const res = await POST(
      postRequest({
        session_id: sessionId,
        ratings: [{ ratee_id: RATEE_ID, score: 6 }],
      })
    );
    expect(res.status).toBe(400);
  });

  it("400 when the rater tries to rate themselves", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: RATER_ID };
    const sessionId = await completedSession();
    const res = await POST(
      postRequest({
        session_id: sessionId,
        ratings: [{ ratee_id: RATER_ID, score: 5 }],
      })
    );
    expect(res.status).toBe(400);
  });

  it("404 when the session does not exist", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: RATER_ID };
    const res = await POST(
      postRequest({
        session_id: crypto.randomUUID(),
        ratings: [{ ratee_id: RATEE_ID, score: 5 }],
      })
    );
    expect(res.status).toBe(404);
  });

  // The gate the whole feature hangs on.
  it("409 when the session has not been completed", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: RATER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: RATER_ID,
      status: "confirmed",
    });
    const res = await POST(
      postRequest({
        session_id: sessionId,
        ratings: [{ ratee_id: RATEE_ID, score: 5 }],
      })
    );
    expect(res.status).toBe(409);
  });

  it("403 when a signed-in user is not a member of the room", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: OUTSIDER_ID };
    const sessionId = await completedSession();
    const res = await POST(
      postRequest({
        session_id: sessionId,
        ratings: [{ ratee_id: RATEE_ID, score: 5 }],
      })
    );
    expect(res.status).toBe(403);
  });

  it("400 when the ratee was not in the session", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: RATER_ID };
    const sessionId = await completedSession();
    const res = await POST(
      postRequest({
        session_id: sessionId,
        ratings: [{ ratee_id: OUTSIDER_ID, score: 5 }],
      })
    );
    expect(res.status).toBe(400);
  });

  it("201 and persists the rating with the review", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: RATER_ID };
    const sessionId = await completedSession();

    const res = await POST(
      postRequest({
        session_id: sessionId,
        ratings: [
          { ratee_id: RATEE_ID, score: 4, review: "Solid spotter, on time" },
        ],
      })
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.ratings).toHaveLength(1);

    const { data, error } = await db
      .from("ratings")
      .select("session_id, rater_id, ratee_id, score, review")
      .eq("session_id", sessionId)
      .single();

    expect(error).toBeNull();
    expect(data?.rater_id).toBe(RATER_ID);
    expect(data?.ratee_id).toBe(RATEE_ID);
    expect(data?.score).toBe(4);
    expect(data?.review).toBe("Solid spotter, on time");
  });

  it("201 with a null review when feedback is omitted", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: RATER_ID };
    const sessionId = await completedSession();

    const res = await POST(
      postRequest({
        session_id: sessionId,
        ratings: [{ ratee_id: RATEE_ID, score: 5 }],
      })
    );
    expect(res.status).toBe(201);

    const { data } = await db
      .from("ratings")
      .select("review")
      .eq("session_id", sessionId)
      .single();
    expect(data?.review).toBeNull();
  });

  it("409 on a second submission, without adding a row", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: RATER_ID };
    const sessionId = await completedSession();
    const body = {
      session_id: sessionId,
      ratings: [{ ratee_id: RATEE_ID, score: 5 }],
    };

    const first = await POST(postRequest(body));
    expect(first.status).toBe(201);

    const second = await POST(postRequest(body));
    expect(second.status).toBe(409);

    const { data } = await db
      .from("ratings")
      .select("id")
      .eq("session_id", sessionId);
    expect(data).toHaveLength(1);
  });

  it("ignores a spoofed rater_id in the body (uses the session identity)", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: RATER_ID };
    const sessionId = await completedSession();

    const res = await POST(
      postRequest({
        session_id: sessionId,
        rater_id: OUTSIDER_ID,
        ratings: [{ ratee_id: RATEE_ID, score: 5 }],
      })
    );
    expect(res.status).toBe(201);

    const { data } = await db
      .from("ratings")
      .select("rater_id")
      .eq("session_id", sessionId)
      .single();
    expect(data?.rater_id).toBe(RATER_ID); // not OUTSIDER_ID
  });
});
