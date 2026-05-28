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

  async function handleSubmit(e: React.FormEvent) {
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

    // Saved — reload the page; it'll now show "you already have a profile".
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
      <label>
        Display name *
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          style={{ display: "block", width: "100%", padding: "0.5rem" }}
        />
      </label>

      <label>
        Age
        <input
          type="number"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          min={13}
          max={120}
          style={{ display: "block", width: "100%", padding: "0.5rem" }}
        />
      </label>

      <label>
        Experience
        <select
          value={experience}
          onChange={(e) => setExperience(e.target.value)}
          style={{ display: "block", width: "100%", padding: "0.5rem" }}
        >
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </label>

      <label>
        Gender
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          style={{ display: "block", width: "100%", padding: "0.5rem" }}
        >
          <option value="">Prefer not to say</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="non-binary">Non-binary</option>
        </select>
      </label>

      <label>
        Bio
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          style={{ display: "block", width: "100%", padding: "0.5rem" }}
        />
      </label>

      <fieldset style={{ padding: "0.5rem" }}>
        <legend>Home gym(s)</legend>
        {gyms.map((g) => (
          <label key={g.id} style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={gymIds.includes(g.id)}
              onChange={() => toggleGym(g.id)}
            />{" "}
            {g.name} — {g.outlet}
          </label>
        ))}
      </fieldset>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <button type="submit" disabled={saving} style={{ padding: "0.75rem" }}>
        {saving ? "Saving…" : "Create profile"}
      </button>
    </form>
  );
}