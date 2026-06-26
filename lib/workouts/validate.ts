export type SetInput = {
  reps: number;
  weight_kg: number;
};

export type ExerciseInput = {
  exercise_name: string;
  sets: SetInput[];
};

export type WorkoutPayload = {
  performed_on: string; // ISO date "YYYY-MM-DD"
  notes?: string | null;
  exercises: ExerciseInput[];
};

export type ValidationResult =
  | { ok: true; value: WorkoutPayload }
  | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateWorkoutPayload(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body must be an object." };
  }
  const b = body as Record<string, unknown>;

  // performed_on: required ISO date, and a real calendar date
  if (typeof b.performed_on !== "string" || !ISO_DATE.test(b.performed_on)) {
    return { ok: false, error: "performed_on must be a YYYY-MM-DD date." };
  }
  if (Number.isNaN(Date.parse(b.performed_on))) {
    return { ok: false, error: "performed_on is not a valid date." };
  }

  // notes: optional string, capped
  if (b.notes != null) {
    if (typeof b.notes !== "string" || b.notes.length > 2000) {
      return { ok: false, error: "notes must be a string up to 2000 chars." };
    }
  }

  // exercises: at least one
  if (!Array.isArray(b.exercises) || b.exercises.length === 0) {
    return { ok: false, error: "At least one exercise is required." };
  }

  const exercises: ExerciseInput[] = [];

  for (const [i, raw] of b.exercises.entries()) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: `Exercise ${i + 1} is malformed.` };
    }
    const ex = raw as Record<string, unknown>;

    const name = typeof ex.exercise_name === "string" ? ex.exercise_name.trim() : "";
    if (name.length < 1 || name.length > 100) {
      return { ok: false, error: `Exercise ${i + 1} name must be 1–100 chars.` };
    }

    if (!Array.isArray(ex.sets) || ex.sets.length === 0) {
      return { ok: false, error: `Exercise "${name}" needs at least one set.` };
    }

    const sets: SetInput[] = [];
    for (const [j, rawSet] of ex.sets.entries()) {
      if (typeof rawSet !== "object" || rawSet === null) {
        return { ok: false, error: `Set ${j + 1} of "${name}" is malformed.` };
      }
      const s = rawSet as Record<string, unknown>;

      if (!Number.isInteger(s.reps) || (s.reps as number) < 1 || (s.reps as number) > 1000) {
        return { ok: false, error: `Set ${j + 1} of "${name}": reps must be 1–1000.` };
      }
      if (typeof s.weight_kg !== "number" || Number.isNaN(s.weight_kg) || s.weight_kg < 0) {
        return { ok: false, error: `Set ${j + 1} of "${name}": weight must be ≥ 0.` };
      }

      sets.push({ reps: s.reps as number, weight_kg: s.weight_kg });
    }

    exercises.push({ exercise_name: name, sets });
  }

  return {
    ok: true,
    value: {
      performed_on: b.performed_on,
      notes: typeof b.notes === "string" ? b.notes : null,
      exercises,
    },
  };
}