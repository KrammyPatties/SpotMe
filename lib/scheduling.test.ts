import { describe, it, expect } from "vitest";
import { validateSessionProposal, buildIcs, deriveSessionStatus } from "./scheduling";

// Fixed clock for all validation tests.
const NOW = new Date("2026-07-25T00:00:00.000Z");

// A valid, well-formed proposal a few days out. Individual tests override
// fields to exercise each rejection path.
function validProposal(overrides: Record<string, unknown> = {}) {
  return {
    chatroom_id: "11111111-1111-4111-8111-111111111111",
    starts_at: "2026-07-28T10:00:00.000Z",
    ends_at: "2026-07-28T11:00:00.000Z",
    gym_id: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  };
}

describe("validateSessionProposal", () => {
  it("accepts a valid future proposal", () => {
    const result = validateSessionProposal(validProposal(), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chatroom_id).toBe(
        "11111111-1111-4111-8111-111111111111"
      );
    }
  });

  it("accepts a null gym_id", () => {
    const result = validateSessionProposal(
      validProposal({ gym_id: null }),
      NOW
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.gym_id).toBeNull();
  });

  it("rejects a non-object payload", () => {
    expect(validateSessionProposal("nope", NOW).ok).toBe(false);
    expect(validateSessionProposal(null, NOW).ok).toBe(false);
    expect(validateSessionProposal(42, NOW).ok).toBe(false);
  });

  it("rejects a malformed chatroom_id", () => {
    const result = validateSessionProposal(
      validProposal({ chatroom_id: "not-a-uuid" }),
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed date", () => {
    const result = validateSessionProposal(
      validProposal({ starts_at: "sometime next week" }),
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("rejects end <= start", () => {
    const result = validateSessionProposal(
      validProposal({
        starts_at: "2026-07-28T11:00:00.000Z",
        ends_at: "2026-07-28T10:00:00.000Z",
      }),
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a start in the past", () => {
    const result = validateSessionProposal(
      validProposal({
        starts_at: "2026-07-24T10:00:00.000Z",
        ends_at: "2026-07-24T11:00:00.000Z",
      }),
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a session shorter than 15 minutes", () => {
    const result = validateSessionProposal(
      validProposal({
        starts_at: "2026-07-28T10:00:00.000Z",
        ends_at: "2026-07-28T10:10:00.000Z",
      }),
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a session longer than 8 hours", () => {
    const result = validateSessionProposal(
      validProposal({
        starts_at: "2026-07-28T10:00:00.000Z",
        ends_at: "2026-07-28T19:00:00.000Z",
      }),
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a session more than 180 days ahead", () => {
    const result = validateSessionProposal(
      validProposal({
        starts_at: "2027-07-28T10:00:00.000Z",
        ends_at: "2027-07-28T11:00:00.000Z",
      }),
      NOW
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed gym_id", () => {
    const result = validateSessionProposal(
      validProposal({ gym_id: "not-a-uuid" }),
      NOW
    );
    expect(result.ok).toBe(false);
  });

  // A +08:00 offset and the equivalent Z instant must
  // normalise to the same canonical UTC string on the way out.
  it("normalises a +08:00 offset to canonical UTC", () => {
    const result = validateSessionProposal(
      validProposal({
        starts_at: "2026-07-28T18:00:00+08:00", // == 10:00Z
        ends_at: "2026-07-28T19:00:00+08:00", // == 11:00Z
      }),
      NOW
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.starts_at).toBe("2026-07-28T10:00:00.000Z");
      expect(result.value.ends_at).toBe("2026-07-28T11:00:00.000Z");
    }
  });
});

describe("buildIcs", () => {
  const baseEvent = {
    uid: "33333333-3333-4333-8333-333333333333",
    starts_at: "2026-07-28T10:00:00.000Z",
    ends_at: "2026-07-28T11:00:00.000Z",
    summary: "Workout with Austin",
    created_at: "2026-07-25T00:00:00.000Z",
  };

  it("includes the required VCALENDAR/VEVENT scaffolding", () => {
    const ics = buildIcs(baseEvent);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
  });

  it("formats dates as basic UTC (20260728T100000Z)", () => {
    const ics = buildIcs(baseEvent);
    expect(ics).toContain("DTSTART:20260728T100000Z");
    expect(ics).toContain("DTEND:20260728T110000Z");
  });

  it("uses CRLF line endings and ends with one", () => {
    const ics = buildIcs(baseEvent);
    expect(ics).toContain("\r\n");
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it("omits LOCATION when absent", () => {
    const ics = buildIcs(baseEvent);
    expect(ics).not.toContain("LOCATION:");
  });

  it("includes and escapes a comma in a gym name", () => {
    const ics = buildIcs({
      ...baseEvent,
      location: "Anytime Fitness, Yishun",
    });
    expect(ics).toContain("LOCATION:Anytime Fitness\\, Yishun");
  });

  it("escapes a backslash without double-escaping", () => {
    const ics = buildIcs({
      ...baseEvent,
      summary: "Leg day \\ core",
    });
    expect(ics).toContain("SUMMARY:Leg day \\\\ core");
  });

  it("folds a line longer than 75 characters", () => {
    const longSummary = "A".repeat(200);
    const ics = buildIcs({ ...baseEvent, summary: longSummary });
    expect(ics).toContain("\r\n ");
    for (const line of ics.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });
});

describe("deriveSessionStatus", () => {
  const PROPOSER = "user_proposer";
  const OTHER = "user_other";
  const THIRD = "user_third";

  const going = (id: string) => ({ user_id: id, status: "going" as const });
  const out = (id: string) => ({ user_id: id, status: "out" as const });

  it("is proposed when only the proposer is going", () => {
    expect(deriveSessionStatus(PROPOSER, [going(PROPOSER)])).toBe("proposed");
  });

  it("is confirmed once a non-proposer is going", () => {
    expect(
      deriveSessionStatus(PROPOSER, [going(PROPOSER), going(OTHER)])
    ).toBe("confirmed");
  });

  it("does not let the proposer confirm their own session", () => {
    expect(
      deriveSessionStatus(PROPOSER, [going(PROPOSER), out(OTHER), out(THIRD)])
    ).toBe("proposed");
  });

  it("reverts to proposed when the last non-proposer opts out", () => {
    expect(
      deriveSessionStatus(PROPOSER, [going(PROPOSER), out(OTHER)])
    ).toBe("proposed");
  });

  it("stays confirmed while any other member is still going", () => {
    expect(
      deriveSessionStatus(PROPOSER, [going(PROPOSER), out(OTHER), going(THIRD)])
    ).toBe("confirmed");
  });

  it("survives the proposer opting out of their own group session", () => {
    expect(
      deriveSessionStatus(PROPOSER, [out(PROPOSER), going(OTHER), going(THIRD)])
    ).toBe("confirmed");
  });

  it("cancels when everyone has opted out", () => {
    expect(
      deriveSessionStatus(PROPOSER, [out(PROPOSER), out(OTHER)])
    ).toBe("cancelled");
  });

  it("cancels on an empty confirmation set", () => {
    expect(deriveSessionStatus(PROPOSER, [])).toBe("cancelled");
  });
});