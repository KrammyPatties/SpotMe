import { describe, it, expect } from "vitest";
import { validateWorkoutPayload } from "./validate";

const validBody = {
  performed_on: "2026-06-26",
  notes: "leg day",
  exercises: [
    { exercise_name: "Squat", sets: [{ reps: 5, weight_kg: 100 }] },
  ],
};

describe("validateWorkoutPayload", () => {
  it("accepts a valid payload", () => {
    const r = validateWorkoutPayload(validBody);
    expect(r.ok).toBe(true);
  });

  it("trims and keeps exercise names", () => {
    const r = validateWorkoutPayload({
      ...validBody,
      exercises: [{ exercise_name: "  Bench  ", sets: [{ reps: 8, weight_kg: 60 }] }],
    });
    expect(r.ok && r.value.exercises[0].exercise_name).toBe("Bench");
  });

  it("rejects a missing date", () => {
    const r = validateWorkoutPayload({ ...validBody, performed_on: undefined });
    expect(r.ok).toBe(false);
  });

  it("rejects a malformed date", () => {
    const r = validateWorkoutPayload({ ...validBody, performed_on: "26-06-2026" });
    expect(r.ok).toBe(false);
  });

  it("rejects zero exercises", () => {
    const r = validateWorkoutPayload({ ...validBody, exercises: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects an empty exercise name", () => {
    const r = validateWorkoutPayload({
      ...validBody,
      exercises: [{ exercise_name: "   ", sets: [{ reps: 5, weight_kg: 100 }] }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an exercise with no sets", () => {
    const r = validateWorkoutPayload({
      ...validBody,
      exercises: [{ exercise_name: "Squat", sets: [] }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects reps out of range", () => {
    const r = validateWorkoutPayload({
      ...validBody,
      exercises: [{ exercise_name: "Squat", sets: [{ reps: 0, weight_kg: 100 }] }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects non-integer reps", () => {
    const r = validateWorkoutPayload({
      ...validBody,
      exercises: [{ exercise_name: "Squat", sets: [{ reps: 5.5, weight_kg: 100 }] }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects negative weight", () => {
    const r = validateWorkoutPayload({
      ...validBody,
      exercises: [{ exercise_name: "Squat", sets: [{ reps: 5, weight_kg: -10 }] }],
    });
    expect(r.ok).toBe(false);
  });

  it("allows zero weight (bodyweight)", () => {
    const r = validateWorkoutPayload({
      ...validBody,
      exercises: [{ exercise_name: "Pushup", sets: [{ reps: 20, weight_kg: 0 }] }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a non-object body", () => {
    expect(validateWorkoutPayload(null).ok).toBe(false);
    expect(validateWorkoutPayload("nope").ok).toBe(false);
  });
});