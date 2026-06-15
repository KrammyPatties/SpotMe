"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMES = ["morning", "afternoon", "evening"] as const;


type Gym = { id: string; name: string; chain: string; postal_code: string };

type InitialData = {
  display_name?: string;
  age?: number | null;
  experience?: string;
  gender?: string | null;
  bio?: string | null;
  gym_ids?: string[];
  workout_style?: string | null;   
  availability?: { day: number; time: string }[];
};
 
export function OnboardingForm({
  gyms,
  initial,
}: {
  gyms: Gym[];
  initial?: InitialData;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [age, setAge] = useState(initial?.age != null ? String(initial.age) : "");
  const [experience, setExperience] = useState(initial?.experience ?? "beginner");
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [gymIds, setGymIds] = useState<string[]>(initial?.gym_ids ?? []);
  const [gymQuery, setGymQuery] = useState("");
  const [workoutStyle, setWorkoutStyle] = useState(initial?.workout_style ?? "no_preference",);
  
  function toggleGym(id: string) {
    setGymIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  }
  
  const [slots, setSlots] = useState<{ day: number; time: string }[]>(
    initial?.availability ?? [],
);

function toggleSlot(day: number, time: string) {
  setSlots((prev) => {
    const exists = prev.some((s) => s.day === day && s.time === time);
    return exists
      ? prev.filter((s) => !(s.day === day && s.time === time))
      : [...prev, { day, time }];
  });
}

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);

    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: displayName,
        age: age === "" ? null : Number(age),
        experience,
        gender: gender === "" ? null : gender,
        bio,
        gym_ids: gymIds,
        workout_style: workoutStyle,
        availability: slots,
    }) });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong.");
      setSaving(false);
      return;
    }

    setSaved(true);
    router.refresh();
  }

    const q = gymQuery.trim().toLowerCase();
    const filteredGyms = q === ""
        ? gyms
        : gyms.filter((g) => g.name.toLowerCase().includes(q));

  const selectedGyms = gyms.filter((g) => gymIds.includes(g.id));

  return (
    <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
        <label className="grid gap-1">
            <span className="text-sm font-medium">Display name *</span>
            <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="rounded border border-ink/20 bg-white px-3 py-2 focus:border-flame focus:outline-none"
            />
        </label>

        <label className="grid gap-1">
            <span className="text-sm font-medium">Age</span>
            <input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            min={13}
            max={120}
            className="rounded border border-ink/20 bg-white px-3 py-2 focus:border-flame focus:outline-none"
            />
        </label>

        <label className="grid gap-1">
            <span className="text-sm font-medium">Experience</span>
            <select
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
            className="rounded border border-ink/20 bg-white px-3 py-2 focus:border-flame focus:outline-none"
            >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
            </select>
        </label>

        <label className="grid gap-1">
            <span className="text-sm font-medium">Gender</span>
            <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="rounded border border-ink/20 bg-white px-3 py-2 focus:border-flame focus:outline-none"
            >
            <option value="">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="non-binary">Non-binary</option>
            </select>
        </label>

        <label className="grid gap-1">
            <span className="text-sm font-medium">Bio</span>
            <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="rounded border border-ink/20 bg-white px-3 py-2 focus:border-flame focus:outline-none"
            />
        </label>

        <fieldset className="rounded border border-ink/20 bg-white p-3">
            <legend className="px-1 text-sm font-medium">Home gym(s)</legend>

            {/* selected gyms as removable chips */}
            {selectedGyms.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                    {selectedGyms.map((g) => (
                        <button
                            key={g.id}
                            type="button"
                            onClick={() => toggleGym(g.id)}
                            className="flex items-center gap-1 rounded-full bg-flame px-3 py-1 text-sm text-cream hover:opacity-90"
                        >
                            {g.name}
                            <span aria-hidden>×</span>
                        </button>
                    ))}
                </div>
            )}

            {/* search box */}
            <input
                type="text"
                value={gymQuery}
                onChange={(e) => setGymQuery(e.target.value)}
                placeholder="Search gyms by name or chain…"
                className="w-full rounded border border-ink/20 px-3 py-2 focus:border-flame focus:outline-none"
            />

            {/* results list - scrollable */}
            <div className="mt-2 max-h-48 overflow-y-auto rounded border border-ink/10">
                {filteredGyms.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-ink/50">No gyms match “{gymQuery}”.</p>
                ) : (
                    filteredGyms.map((g) => {
                        const selected = gymIds.includes(g.id);
                        return (
                            <button
                                key={g.id}
                                type="button"
                                onClick={() => toggleGym(g.id)}
                                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-ink/5 ${
                                    selected ? "font-medium text-flame" : ""
                                }`}
                            >
                                <span>{g.name}</span>
                                {selected && <span aria-hidden>✓</span>}
                            </button>
                        );
                    })
                )}
            </div>
        </fieldset>

        <label className="grid gap-1">
            <span className="text-sm font-medium">Workout style</span>
            <select
                value={workoutStyle}
                onChange={(e) => setWorkoutStyle(e.target.value)}
                className="rounded border border-ink/20 bg-white px-3 py-2 focus:border-flame focus:outline-none"
            >
                <option value="no_preference">No preference</option>
                <option value="powerlifting">Powerlifting</option>
                <option value="bodybuilding">Bodybuilding</option>
                <option value="hiit">HIIT</option>
                <option value="calisthenics">Calisthenics</option>
                <option value="crossfit">CrossFit</option>
                <option value="general">General fitness</option>
            </select>
        </label>

        <fieldset className="rounded border border-ink/20 bg-white p-3">
        <legend className="px-1 text-sm font-medium">Availability</legend>
        <div className="grid grid-cols-4 gap-1 text-sm">
            {/* header row: empty corner + time labels */}
            <span />
            {TIMES.map((t) => (
            <span key={t} className="text-center font-medium capitalize">{t}</span>
            ))}

            {/* one row per day */}
            {DAYS.map((label, day) => (
            <div key={day} className="contents">
                <span className="flex items-center font-medium">{label}</span>
                {TIMES.map((time) => {
                const on = slots.some((s) => s.day === day && s.time === time);
                return (
                    <button
                    key={time}
                    type="button"
                    onClick={() => toggleSlot(day, time)}
                    className={`rounded px-2 py-2 ${
                        on ? "bg-flame text-cream" : "bg-ink/5 text-ink hover:bg-ink/10"
                    }`}
                    >
                    {on ? "✓" : ""}
                    </button>
                );
                })}
            </div>
            ))}
        </div>
        </fieldset>
        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
            type="submit"
            disabled={saving}
            className="bg-flame px-4 py-3 font-semibold text-cream hover:opacity-90 disabled:opacity-50"
        >
            {saving ? "Saving…" : saved ? "Saved!" : initial ? "Edit profile" : "Create profile"}
        </button>
    </form>
  );
}