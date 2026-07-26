"use client";

import { useState } from "react";
import { MAX_REASON_LENGTH } from "@/lib/moderation";

const CATEGORIES = [
  "Harassment or abuse",
  "Inappropriate photo or bio",
  "Spam or scam",
  "Safety concern",
  "Other",
] as const;

type Category = (typeof CATEGORIES)[number];

export default function ReportDialog({
  reportedId,
  reportedName,
  onReported,
}: {
  reportedId: string;
  reportedName: string;
  onReported?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category | "">("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function close() {
    setOpen(false);
    setCategory("");
    setReason("");
    setError(null);
    setDone(false);
  }

  const prefix = category ? `${category} — ` : "";
  const remaining = MAX_REASON_LENGTH - prefix.length;

  async function submit() {
    if (!category || !reason.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reported_id: reportedId,
          reason: prefix + reason.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Couldn't submit the report. Please try again.");
        setSubmitting(false);
        return;
      }

      setDone(true);
      setSubmitting(false);
      onReported?.();
    } catch {
      setError("Couldn't submit the report. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-ink/50 underline hover:text-ink"
      >
        Report
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgb(17 17 17 / 0.5)" }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-ink/10 bg-cream p-5 shadow-lg">
            {done ? (
              <>
                <h2 className="text-lg font-bold">Report submitted</h2>
                <p className="mt-2 text-sm text-ink/70">
                  Thanks. A moderator will review this.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-5 w-full rounded-xl bg-flame px-4 py-2 text-sm font-medium text-cream"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold">Report {reportedName}</h2>
                <p className="mt-1 text-sm text-ink/70">
                  Tell us what happened. Only moderators see this.
                </p>

                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  className="mt-3 w-full rounded-xl border border-ink/20 bg-cream px-3 py-2 text-sm"
                >
                  <option value="">Choose a category…</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={remaining}
                  rows={4}
                  placeholder="What's the issue?"
                  className="mt-3 w-full rounded-xl border border-ink/20 bg-cream px-3 py-2 text-sm"
                />
                <p className="mt-1 text-right text-xs text-ink/40">
                  {reason.length}/{remaining}
                </p>

                {error && (
                  <p className="mt-2 text-sm" style={{ color: "#f95311" }}>
                    {error}
                  </p>
                )}

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="flex-1 rounded-xl border border-ink/20 px-4 py-2 text-sm font-medium text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!category || !reason.trim() || submitting}
                    className="flex-1 rounded-xl bg-flame px-4 py-2 text-sm font-medium text-cream disabled:opacity-50"
                  >
                    {submitting ? "Submitting…" : "Submit"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}