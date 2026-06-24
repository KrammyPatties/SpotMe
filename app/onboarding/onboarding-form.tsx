"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMES = ["morning", "afternoon", "evening"] as const;
const EXPERIENCE_OPTS = ["beginner", "intermediate", "advanced"];
const GENDER_OPTS = ["male", "female", "non-binary"];
const STYLE_OPTS = ["powerlifting", "bodybuilding", "hiit", "calisthenics", "crossfit", "general"];

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
  preferred_experience?: string[];
  preferred_gender?: string[];
  preferred_styles?: string[];
  photo_url?: string | null;
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
  const [prefExperience, setPrefExperience] = useState<string[]>(initial?.preferred_experience ?? []);
  const [prefGender, setPrefGender] = useState<string[]>(initial?.preferred_gender ?? []);
  const [prefStyles, setPrefStyles] = useState<string[]>(initial?.preferred_styles ?? []);

  const [photoPreview, setPhotoPreview] = useState<string | null>(initial?.photo_url ?? null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  
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

function toggleInArray(
  setter: React.Dispatch<React.SetStateAction<string[]>>,
  value: string,
) {
  setter((prev) =>
    prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
  );
}

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0];
  if (!file) return;

  setPhotoError(null);

  // Client-side validation (the real gatekeeper; bucket is a backstop).
  if (!ALLOWED_TYPES.includes(file.type)) {
    setPhotoError("Please choose a JPEG, PNG, WebP, or HEIC image.");
    return;
  }
  if (file.size > MAX_BYTES) {
    setPhotoError("Image must be under 5 MB.");
    return;
  }

  setPhotoUploading(true);
  try {
    // Step 1: ask our server for a scoped upload URL
    const urlRes = await fetch("/api/profile/photo-upload-url", { method: "POST" });
    if (!urlRes.ok) throw new Error("Could not start upload.");
    const { path, token } = await urlRes.json();

    // Step 2: upload the file directly to Supabase (bypasses our server)
    const { error: uploadErr } = await supabaseBrowser.storage
      .from("profile-photos")
      .uploadToSignedUrl(path, token, file);
    if (uploadErr) throw new Error(uploadErr.message);

    // Step 3: tell our server to save the path on the profile
    const saveRes = await fetch("/api/profile/photo-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!saveRes.ok) throw new Error("Could not save photo.");

    // Show a local preview immediately
    setPhotoPreview(URL.createObjectURL(file));
  } catch (err) {
    setPhotoError(err instanceof Error ? err.message : "Upload failed.");
  } finally {
    setPhotoUploading(false);
  }
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
        preferred_experience: prefExperience,
        preferred_gender: prefGender,
        preferred_styles: prefStyles,
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

        <div className="grid gap-1">
            <span className="text-sm font-medium">Profile photo</span>

            {photoPreview && (
                <img
                    src={photoPreview}
                    alt="Preview"
                    className="mb-2 h-32 w-32 rounded-full object-cover"
                />
            )}

            <label
                className={`inline-block w-fit cursor-pointer rounded border border-flame px-4 py-2 text-sm font-medium text-flame hover:bg-flame hover:text-cream ${
                    photoUploading ? "pointer-events-none opacity-50" : ""
                }`}
            >
                {photoPreview ? "Change photo" : "Upload photo"}
                <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    disabled={photoUploading}
                    style={{
                        position: "absolute",
                        width: "1px",
                        height: "1px",
                        padding: 0,
                        margin: "-1px",
                        overflow: "hidden",
                        clip: "rect(0,0,0,0)",
                        whiteSpace: "nowrap",
                        border: 0,
                    }}
                />
            </label>

            {photoUploading && <span className="text-sm text-ink/60">Uploading…</span>}
            {photoError && <span className="text-sm text-red-600">{photoError}</span>}
        </div>

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

        <fieldset className="rounded border border-ink/20 bg-white p-3">
            <legend className="px-1 text-sm font-medium">I want to train with - experience level</legend>

            {/* No preference: checked when the array is empty; clears the group */}
            <label className="flex items-center gap-2 py-1">
                <input
                    type="checkbox"
                    checked={prefExperience.length === 0}
                    onChange={() => setPrefExperience([])}
                    className="accent-flame"
                />
                <span>No preference</span>
            </label>

            {EXPERIENCE_OPTS.map((opt) => (
                <label key={opt} className="flex items-center gap-2 py-1">
                    <input
                        type="checkbox"
                        checked={prefExperience.includes(opt)}
                        onChange={() => toggleInArray(setPrefExperience, opt)}
                        className="accent-flame"
                    />
                    <span className="capitalize">{opt}</span>
                </label>
            ))}
        </fieldset>

                <fieldset className="rounded border border-ink/20 bg-white p-3">
            <legend className="px-1 text-sm font-medium">I want to train with - gender</legend>

            <label className="flex items-center gap-2 py-1">
                <input
                    type="checkbox"
                    checked={prefGender.length === 0}
                    onChange={() => setPrefGender([])}
                    className="accent-flame"
                />
                <span>No preference</span>
            </label>

            {GENDER_OPTS.map((opt) => (
                <label key={opt} className="flex items-center gap-2 py-1">
                    <input
                        type="checkbox"
                        checked={prefGender.includes(opt)}
                        onChange={() => toggleInArray(setPrefGender, opt)}
                        className="accent-flame"
                    />
                    <span className="capitalize">{opt}</span>
                </label>
            ))}
        </fieldset>

        <fieldset className="rounded border border-ink/20 bg-white p-3">
            <legend className="px-1 text-sm font-medium">I want to try - workout style</legend>

            <label className="flex items-center gap-2 py-1">
                <input
                    type="checkbox"
                    checked={prefStyles.length === 0}
                    onChange={() => setPrefStyles([])}
                    className="accent-flame"
                />
                <span>No preference</span>
            </label>

            {STYLE_OPTS.map((opt) => (
                <label key={opt} className="flex items-center gap-2 py-1">
                    <input
                        type="checkbox"
                        checked={prefStyles.includes(opt)}
                        onChange={() => toggleInArray(setPrefStyles, opt)}
                        className="accent-flame"
                    />
                    <span className="capitalize">{opt}</span>
                </label>
            ))}
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