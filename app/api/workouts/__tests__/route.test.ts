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

// Build the real test-DB client + a mutable auth holder, before imports.
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

const USER_ID = "test_user_workouts";

const db: SupabaseClient = testDb;
const createdSessionIds: string[] = [];

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/workouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  performed_on: "2026-06-26",
  notes: "integration test session",
  exercises: [
    { exercise_name: "Bench Press", sets: [{ reps: 8, weight_kg: 60 }] },
  ],
};

beforeAll(async () => {
  await db
    .from("profiles")
    .upsert({ clerk_user_id: USER_ID, display_name: "Workout Test User" });
});

afterAll(async () => {
  // Delete sessions we created (sets cascade), then the test profile.
  if (createdSessionIds.length) {
    await db.from("workout_sessions").delete().in("id", createdSessionIds);
  }
  await db.from("profiles").delete().eq("clerk_user_id", USER_ID);
});

beforeEach(() => {
  currentAuthRef.value = { isAuthenticated: false, userId: null };
});

describe("POST /api/workouts", () => {
  it("401 when the request is not authenticated", async () => {
    currentAuthRef.value = { isAuthenticated: false, userId: null };
    const res = await POST(postRequest(validBody));
    expect(res.status).toBe(401);
  });

  it("400 when there are no exercises", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: USER_ID };
    const res = await POST(postRequest({ ...validBody, exercises: [] }));
    expect(res.status).toBe(400);
  });

  it("400 when reps are out of range", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: USER_ID };
    const res = await POST(
      postRequest({
        ...validBody,
        exercises: [
          { exercise_name: "Squat", sets: [{ reps: 0, weight_kg: 100 }] },
        ],
      })
    );
    expect(res.status).toBe(400);
  });

  it("400 when weight is negative", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: USER_ID };
    const res = await POST(
      postRequest({
        ...validBody,
        exercises: [
          { exercise_name: "Squat", sets: [{ reps: 5, weight_kg: -10 }] },
        ],
      })
    );
    expect(res.status).toBe(400);
  });

  it("201 and persists the session + sets for a valid payload", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: USER_ID };

    const body = {
      performed_on: "2026-06-26",
      notes: "integration test session",
      exercises: [
        {
          exercise_name: "Bench Press",
          sets: [
            { reps: 8, weight_kg: 60 },
            { reps: 6, weight_kg: 65 },
          ],
        },
        { exercise_name: "Squat", sets: [{ reps: 5, weight_kg: 100 }] },
      ],
    };

    const res = await POST(postRequest(body));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.id).toBeTruthy();
    createdSessionIds.push(json.id); // register for cleanup

    // Session row exists and is owned by the authed user, not the body.
    const { data: session, error: sessionErr } = await db
      .from("workout_sessions")
      .select("id, clerk_user_id, performed_on, notes")
      .eq("id", json.id)
      .single();
    expect(sessionErr).toBeNull();
    expect(session?.clerk_user_id).toBe(USER_ID);
    expect(session?.performed_on).toBe("2026-06-26");

    // All three sets persisted, linked to the session, indexed per exercise.
    const { data: sets, error: setsErr } = await db
      .from("workout_sets")
      .select("exercise_name, set_index, reps, weight_kg")
      .eq("session_id", json.id)
      .order("exercise_name", { ascending: true })
      .order("set_index", { ascending: true });
    expect(setsErr).toBeNull();
    expect(sets).toHaveLength(3);

    const bench = sets!.filter((s) => s.exercise_name === "Bench Press");
    expect(bench).toHaveLength(2);
    expect(bench[0].set_index).toBe(1);
    expect(bench[1].set_index).toBe(2);
  });

  it("assigns clerk_user_id from the session, not the request body", async () => {
    currentAuthRef.value = { isAuthenticated: true, userId: USER_ID };

    const res = await POST(
      postRequest({ ...validBody, clerk_user_id: "spoofed_user" })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    createdSessionIds.push(json.id);

    const { data } = await db
      .from("workout_sessions")
      .select("clerk_user_id")
      .eq("id", json.id)
      .single();
    expect(data?.clerk_user_id).toBe(USER_ID); // not "spoofed_user"
  });
});