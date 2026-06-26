"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SetRow = { reps: string; weight_kg: string };
type ExerciseBlock = { exercise_name: string; sets: SetRow[] };

const emptySet = (): SetRow => ({ reps: "", weight_kg: "" });
const emptyExercise = (): ExerciseBlock => ({
  exercise_name: "",
  sets: [emptySet()],
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LogWorkout() {
  const router = useRouter();
  const [performedOn, setPerformedOn] = useState(today());
  const [notes, setNotes] = useState("");
  const [exercises, setExercises] = useState<ExerciseBlock[]>([emptyExercise()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateSet(exIdx: number, setIdx: number, field: keyof SetRow, value: string) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i !== exIdx
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s, j) =>
                j !== setIdx ? s : { ...s, [field]: value }
              ),
            }
      )
    );
  }

  function updateName(exIdx: number, value: string) {
    setExercises((prev) =>
      prev.map((ex, i) => (i !== exIdx ? ex : { ...ex, exercise_name: value }))
    );
  }

  function addSet(exIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) => (i !== exIdx ? ex : { ...ex, sets: [...ex.sets, emptySet()] }))
    );
  }

  function removeSet(exIdx: number, setIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) =>
        i !== exIdx ? ex : { ...ex, sets: ex.sets.filter((_, j) => j !== setIdx) }
      )
    );
  }

  function addExercise() {
    setExercises((prev) => [...prev, emptyExercise()]);
  }

  function removeExercise(exIdx: number) {
    setExercises((prev) => prev.filter((_, i) => i !== exIdx));
  }

  async function handleSubmit() {
    setError(null);

    // Shape into the API payload, dropping empty set rows.
    const payload = {
      performed_on: performedOn,
      notes: notes.trim() || null,
      exercises: exercises
        .map((ex) => ({
          exercise_name: ex.exercise_name.trim(),
          sets: ex.sets
            .filter((s) => s.reps !== "" && s.weight_kg !== "")
            .map((s) => ({ reps: Number(s.reps), weight_kg: Number(s.weight_kg) })),
        }))
        .filter((ex) => ex.exercise_name && ex.sets.length > 0),
    };

    if (payload.exercises.length === 0) {
      setError("Add at least one exercise with a set.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not save workout.");
        return;
      }
      // Reset form and refresh the server-rendered history.
      setExercises([emptyExercise()]);
      setNotes("");
      setPerformedOn(today());
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white/60 p-4">
      <h2 className="mb-4 text-lg font-semibold">Log a workout</h2>

      <div className="mb-4 flex flex-wrap gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-ink/70">Date</span>
          <input
            type="date"
            value={performedOn}
            onChange={(e) => setPerformedOn(e.target.value)}
            className="rounded border border-ink/20 px-2 py-1"
          />
        </label>
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-ink/70">Notes (optional)</span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. felt strong today"
            className="w-full rounded border border-ink/20 px-2 py-1"
          />
        </label>
      </div>

      {exercises.map((ex, exIdx) => (
        <div key={exIdx} className="mb-4 rounded border border-ink/10 p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={ex.exercise_name}
              onChange={(e) => updateName(exIdx, e.target.value)}
              placeholder="Exercise name"
              className="flex-1 rounded border border-ink/20 px-2 py-1 font-medium"
            />
            {exercises.length > 1 && (
              <button
                type="button"
                onClick={() => removeExercise(exIdx)}
                className="text-sm text-ink/50 hover:text-flame"
              >
                Remove
              </button>
            )}
          </div>

          <div className="space-y-2">
            {ex.sets.map((set, setIdx) => (
              <div key={setIdx} className="flex items-center gap-2 text-sm">
                <span className="w-12 text-ink/50">Set {setIdx + 1}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  value={set.weight_kg}
                  onChange={(e) => updateSet(exIdx, setIdx, "weight_kg", e.target.value)}
                  placeholder="kg"
                  className="w-20 rounded border border-ink/20 px-2 py-1"
                />
                <span className="text-ink/40">×</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={set.reps}
                  onChange={(e) => updateSet(exIdx, setIdx, "reps", e.target.value)}
                  placeholder="reps"
                  className="w-20 rounded border border-ink/20 px-2 py-1"
                />
                {ex.sets.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSet(exIdx, setIdx)}
                    className="text-ink/40 hover:text-flame"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => addSet(exIdx)}
            className="mt-2 text-sm text-flame hover:underline"
          >
            + Add set
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addExercise}
        className="mb-4 text-sm text-flame hover:underline"
      >
        + Add exercise
      </button>

      {error && <p className="mb-3 text-sm text-flame">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full rounded-lg bg-flame px-4 py-2 font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save workout"}
      </button>
    </div>
  );
}