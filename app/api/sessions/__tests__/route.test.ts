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
  futureIso,
  pastIso,
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

import { POST as PROPOSE } from "../route";
import { POST as RESPOND } from "../respond/route";
import { GET as ICS } from "../[id]/ics/route";

const PROPOSER_ID = "test_user_proposer";
const PARTNER_ID = "test_user_partner";
const NONMEMBER_ID = "test_user_nonmember";

const db: SupabaseClient = testDb;
let roomId: string;

function proposeRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function respondRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function icsRequest(id: string) {
  return [
    new Request(`http://localhost/api/sessions/${id}/ics`),
    { params: Promise.resolve({ id }) },
  ] as const;
}

function validProposal(overrides: Record<string, unknown> = {}) {
  return {
    chatroom_id: roomId,
    starts_at: futureIso(7, 10),
    ends_at: futureIso(7, 11),
    gym_id: null,
    ...overrides,
  };
}

beforeAll(async () => {
  await seedProfile(db, PROPOSER_ID, "Proposer User");
  await seedProfile(db, PARTNER_ID, "Partner User");
  await seedProfile(db, NONMEMBER_ID, "Non-member User");
  roomId = await seedChatroom(db);
  await seedMember(db, roomId, PROPOSER_ID);
  await seedMember(db, roomId, PARTNER_ID);
});

afterAll(async () => {
  await cleanup(db, [roomId], [PROPOSER_ID, PARTNER_ID, NONMEMBER_ID]);
});

beforeEach(() => {
  // Default to signed-out, each test opts into an identity.
  currentAuthRef.value = { isAuthenticated: false, userId: null };
});

describe("POST /api/sessions", () => {
  it("401 when the request is not authenticated", async () => {
    currentAuthRef.value = { isAuthenticated: false, userId: null };
    const res = await PROPOSE(proposeRequest(validProposal()));
    expect(res.status).toBe(401);
  });

  it("400 when the proposal fails validation", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const res = await PROPOSE(
      proposeRequest(
        validProposal({
          starts_at: futureIso(7, 11),
          ends_at: futureIso(7, 10), // ends before it starts
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it("400 when the session is in the past", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const res = await PROPOSE(
      proposeRequest(
        validProposal({ starts_at: pastIso(2, 10), ends_at: pastIso(2, 11) })
      )
    );
    expect(res.status).toBe(400);
  });

  it("403 when a signed-in user is not a member of the room", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: NONMEMBER_ID };
    const res = await PROPOSE(proposeRequest(validProposal()));
    expect(res.status).toBe(403);
  });

  it("201 and persists the row, defaulting status to 'proposed'", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };

    const res = await PROPOSE(proposeRequest(validProposal()));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.session).toBeTruthy();
    expect(json.session.status).toBe("proposed");
    expect(json.session.responded_at).toBeNull();

    // Confirm it actually landed in the DB.
    const { data, error } = await db
      .from("scheduled_sessions")
      .select("id, chatroom_id, proposer_id, status, gym_id")
      .eq("id", json.session.id)
      .single();

    expect(error).toBeNull();
    expect(data?.chatroom_id).toBe(roomId);
    expect(data?.proposer_id).toBe(PROPOSER_ID);
    expect(data?.status).toBe("proposed");
    expect(data?.gym_id).toBeNull();
  });

  it("normalises a non-UTC offset to canonical UTC on write", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };

    const utcStart = futureIso(9, 10);
    const localStart = new Date(utcStart).toISOString(); // same instant

    const res = await PROPOSE(
      proposeRequest(
        validProposal({ starts_at: localStart, ends_at: futureIso(9, 11) })
      )
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(new Date(json.session.starts_at).toISOString()).toBe(utcStart);
  });

  it("ignores a spoofed proposer_id in the body (uses the session identity)", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };

    const res = await PROPOSE(
      proposeRequest(validProposal({ proposer_id: NONMEMBER_ID }))
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.session.proposer_id).toBe(PROPOSER_ID); // not NONMEMBER_ID
  });
});

describe("POST /api/sessions/respond", () => {
  it("401 when the request is not authenticated", async () => {
    currentAuthRef.value = { isAuthenticated: false, userId: null };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    const res = await RESPOND(
      respondRequest({ session_id: sessionId, action: "confirm" })
    );
    expect(res.status).toBe(401);
  });

  it("400 when the action is not confirm or cancel", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    const res = await RESPOND(
      respondRequest({ session_id: sessionId, action: "maybe" })
    );
    expect(res.status).toBe(400);
  });

  it("404 when the session does not exist", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const res = await RESPOND(
      respondRequest({ session_id: crypto.randomUUID(), action: "confirm" })
    );
    expect(res.status).toBe(404);
  });

  it("403 when a signed-in user is not a member of the room", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: NONMEMBER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    const res = await RESPOND(
      respondRequest({ session_id: sessionId, action: "confirm" })
    );
    expect(res.status).toBe(403);
  });

  // Confirming needs a second person, cancelling does not.
  it("403 when the proposer tries to confirm their own proposal", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    const res = await RESPOND(
      respondRequest({ session_id: sessionId, action: "confirm" })
    );
    expect(res.status).toBe(403);
  });

  it("allows the proposer to cancel their own proposal", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });

    const res = await RESPOND(
      respondRequest({ session_id: sessionId, action: "cancel" })
    );
    expect(res.status).toBe(200);

    const { data } = await db
      .from("scheduled_sessions")
      .select("status")
      .eq("id", sessionId)
      .single();
    expect(data?.status).toBe("cancelled");
  });

  it("200 and persists status + responded_at when the partner confirms", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });

    const res = await RESPOND(
      respondRequest({ session_id: sessionId, action: "confirm" })
    );
    expect(res.status).toBe(200);

    const { data, error } = await db
      .from("scheduled_sessions")
      .select("status, responded_at")
      .eq("id", sessionId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe("confirmed");
    expect(data?.responded_at).not.toBeNull();
  });

  it("409 on a second response, leaving the first verdict intact", async () => {
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });

    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const first = await RESPOND(
      respondRequest({ session_id: sessionId, action: "confirm" })
    );
    expect(first.status).toBe(200);

    const second = await RESPOND(
      respondRequest({ session_id: sessionId, action: "cancel" })
    );
    expect(second.status).toBe(409);

    const { data } = await db
      .from("scheduled_sessions")
      .select("status")
      .eq("id", sessionId)
      .single();
    expect(data?.status).toBe("confirmed"); // not overwritten to cancelled
  });
});

describe("GET /api/sessions/[id]/ics", () => {
  it("401 when the request is not authenticated", async () => {
    currentAuthRef.value = { isAuthenticated: false, userId: null };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
      status: "confirmed",
    });
    const res = await ICS(...icsRequest(sessionId));
    expect(res.status).toBe(401);
  });

  it("403 when a signed-in user is not a member of the room", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: NONMEMBER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
      status: "confirmed",
    });
    const res = await ICS(...icsRequest(sessionId));
    expect(res.status).toBe(403);
  });

  it("409 when the session is still only proposed", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
      status: "proposed",
    });
    const res = await ICS(...icsRequest(sessionId));
    expect(res.status).toBe(409);
  });

  it("200 with a text/calendar body for a confirmed session", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
      status: "confirmed",
    });

    const res = await ICS(...icsRequest(sessionId));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");

    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");
    expect(body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(body).toContain(`UID:${sessionId}@`);
    expect(body).toContain("Partner User");
  });
});