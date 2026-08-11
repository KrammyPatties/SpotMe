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
  seedConfirmation,
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
import { POST as ATTEND } from "../attend/route";
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

function attendRequest(body: unknown): Request {
  return new Request("http://localhost/api/sessions/attend", {
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

    // The proposer's attendance is written in the same request. Read it
    // from the DB, not the response: the response is built from the
    // session insert and would echo success even if this never landed.
    const { data: conf } = await db
      .from("session_confirmations")
      .select("user_id, status")
      .eq("session_id", json.session.id);

    expect(conf).toHaveLength(1);
    expect(conf?.[0].user_id).toBe(PROPOSER_ID);
    expect(conf?.[0].status).toBe("going");
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
      respondRequest({ session_id: sessionId, action: "cancel" })
    );
    expect(res.status).toBe(401);
  });

  it("400 when the action is not cancel", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    const res = await RESPOND(
      respondRequest({ session_id: sessionId, action: "maybe" })
    );
    expect(res.status).toBe(400);
  });

  // Confirming moved to /attend; a client sending the old verb gets a
  // legible 400 rather than silence.
  it("400 on the retired 'confirm' action", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    const res = await RESPOND(
      respondRequest({ session_id: sessionId, action: "confirm" })
    );
    expect(res.status).toBe(400);
  });

  it("404 when the session does not exist", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const res = await RESPOND(
      respondRequest({ session_id: crypto.randomUUID(), action: "cancel" })
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
      respondRequest({ session_id: sessionId, action: "cancel" })
    );
    expect(res.status).toBe(403);
  });

  // The asymmetry, inverted: the proposer could never confirm, and now
  // only the proposer can cancel. A member who no longer wants to attend
  // opts out via /attend rather than calling the session off for everyone.
  it("403 when a non-proposer tries to cancel", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    const res = await RESPOND(
      respondRequest({ session_id: sessionId, action: "cancel" })
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

  // The .eq("status","proposed") guard was widened to .in(...) — without
  // that change this returns 409 and a confirmed session can never be
  // called off.
  it("allows the proposer to cancel a confirmed session", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
      status: "confirmed",
    });

    const res = await RESPOND(
      respondRequest({ session_id: sessionId, action: "cancel" })
    );
    expect(res.status).toBe(200);
  });

  it("409 on a second cancel, leaving the first verdict intact", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });

    const first = await RESPOND(
      respondRequest({ session_id: sessionId, action: "cancel" })
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
    expect(data?.status).toBe("cancelled");
  });
});

describe("POST /api/sessions/attend", () => {
  it("401 when the request is not authenticated", async () => {
    currentAuthRef.value = { isAuthenticated: false, userId: null };
    const res = await ATTEND(
      attendRequest({ session_id: crypto.randomUUID(), going: true })
    );
    expect(res.status).toBe(401);
  });

  it("400 when session_id is not a uuid", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const res = await ATTEND(attendRequest({ session_id: "nope", going: true }));
    expect(res.status).toBe(400);
  });

  it("400 when going is not a boolean", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    const res = await ATTEND(
      attendRequest({ session_id: sessionId, going: "yes" })
    );
    expect(res.status).toBe(400);
  });

  it("404 when the session does not exist", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const res = await ATTEND(
      attendRequest({ session_id: crypto.randomUUID(), going: true })
    );
    expect(res.status).toBe(404);
  });

  it("403 when a signed-in user is not a member of the room", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: NONMEMBER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    const res = await ATTEND(
      attendRequest({ session_id: sessionId, going: true })
    );
    expect(res.status).toBe(403);
  });

  it("409 against a completed session", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
      status: "completed",
    });
    const res = await ATTEND(
      attendRequest({ session_id: sessionId, going: true })
    );
    expect(res.status).toBe(409);
  });

  it("flips proposed to confirmed when a non-proposer joins", async () => {
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    await seedConfirmation(db, sessionId, PROPOSER_ID, "going");

    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const res = await ATTEND(
      attendRequest({ session_id: sessionId, going: true })
    );
    expect(res.status).toBe(200);

    const { data } = await db
      .from("scheduled_sessions")
      .select("status, responded_at")
      .eq("id", sessionId)
      .single();
    expect(data?.status).toBe("confirmed");
    expect(data?.responded_at).not.toBeNull();
  });

  // The successor to "403 when the proposer tries to confirm their own
  // proposal": same intent, now enforced by arithmetic in
  // deriveSessionStatus rather than by a route guard.
  it("does not let the proposer confirm their own session", async () => {
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    await seedConfirmation(db, sessionId, PROPOSER_ID, "going");

    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const res = await ATTEND(
      attendRequest({ session_id: sessionId, going: true })
    );
    expect(res.status).toBe(200);

    const { data } = await db
      .from("scheduled_sessions")
      .select("status")
      .eq("id", sessionId)
      .single();
    expect(data?.status).toBe("proposed");
  });

  it("reverts to proposed when the last non-proposer opts out", async () => {
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
      status: "confirmed",
    });
    await seedConfirmation(db, sessionId, PROPOSER_ID, "going");
    await seedConfirmation(db, sessionId, PARTNER_ID, "going");

    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const res = await ATTEND(
      attendRequest({ session_id: sessionId, going: false })
    );
    expect(res.status).toBe(200);

    const { data } = await db
      .from("scheduled_sessions")
      .select("status")
      .eq("id", sessionId)
      .single();
    expect(data?.status).toBe("proposed");
  });

  it("cancels the session when everyone has opted out", async () => {
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    await seedConfirmation(db, sessionId, PROPOSER_ID, "going");
    await seedConfirmation(db, sessionId, PARTNER_ID, "out");

    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
    const res = await ATTEND(
      attendRequest({ session_id: sessionId, going: false })
    );
    expect(res.status).toBe(200);

    const { data } = await db
      .from("scheduled_sessions")
      .select("status")
      .eq("id", sessionId)
      .single();
    expect(data?.status).toBe("cancelled");
  });

  // Two members attending is not a race to a single verdict: both writes
  // are legitimate and both land, which is why the .eq("status","proposed")
  // guard on /respond does not belong on this route.
  it("is idempotent: one row and one status after a repeated request", async () => {
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
    });
    await seedConfirmation(db, sessionId, PROPOSER_ID, "going");

    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const first = await ATTEND(
      attendRequest({ session_id: sessionId, going: true })
    );
    const second = await ATTEND(
      attendRequest({ session_id: sessionId, going: true })
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const { data: rows } = await db
      .from("session_confirmations")
      .select("user_id")
      .eq("session_id", sessionId)
      .eq("user_id", PARTNER_ID);
    expect(rows).toHaveLength(1);

    const { data } = await db
      .from("scheduled_sessions")
      .select("status")
      .eq("id", sessionId)
      .single();
    expect(data?.status).toBe("confirmed");
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

  // A member who opted out should not get a calendar file for a session
  // they are not attending.
  it("403 when a member has opted out of the session", async () => {
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
      status: "confirmed",
    });
    await seedConfirmation(db, sessionId, PROPOSER_ID, "going");
    await seedConfirmation(db, sessionId, PARTNER_ID, "out");

    currentAuthRef.value = { isAuthenticated: true, userId: PARTNER_ID };
    const res = await ICS(...icsRequest(sessionId));
    expect(res.status).toBe(403);
  });

  it("200 with a text/calendar body for a confirmed session", async () => {
    const sessionId = await seedSession(db, {
      chatroomId: roomId,
      proposerId: PROPOSER_ID,
      status: "confirmed",
    });
    await seedConfirmation(db, sessionId, PROPOSER_ID, "going");

    currentAuthRef.value = { isAuthenticated: true, userId: PROPOSER_ID };
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