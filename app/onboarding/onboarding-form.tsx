"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Gym = { id: string; name: string; outlet: string; region: string | null };

export function OnboardingForm({ gyms }: { gyms: Gym[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [age, setAge] = useState("");
  const [experience, setExperience] = useState("beginner");
  const [gender, setGender] = useState("");
  const [bio, setBio] = useState("");
  const [gymIds, setGymIds] = useState<string[]>([]);

  function toggleGym(id: string) {
    setGymIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
  }
  
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
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
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong.");
      setSaving(false);
      return;
    }

    router.refresh();
  }

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
            {gyms.map((g) => (
            <label key={g.id} className="flex items-center gap-2 py-1">
                <input
                type="checkbox"
                checked={gymIds.includes(g.id)}
                onChange={() => toggleGym(g.id)}
                className="accent-flame"
                />
                <span>{g.name} — {g.outlet}</span>
            </label>
            ))}
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
            type="submit"
            disabled={saving}
            className="bg-flame px-4 py-3 font-semibold text-cream hover:opacity-90 disabled:opacity-50"
        >
            {saving ? "Saving…" : "Create profile"}
        </button>
    </form>
  );
}