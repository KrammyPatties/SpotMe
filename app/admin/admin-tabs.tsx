"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import RatingBadge from "@/app/components/rating-badge";
import { aggregateRating } from "@/lib/ratings";
import { MAX_REASON_LENGTH, MAX_SUSPENSION_DAYS } from "@/lib/moderation";
import type {
  ActionLogEntry,
  DashboardStats,
  FlaggedUser,
  QueueReport,
  ReviewEntry,
} from "@/lib/supabase/moderation";

const FLAME = "#f95311";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const FLAG_LABEL: Record<string, string> = {
  severe: "Severe",
  watch: "Watch",
  unrated: "Unrated",
  ok: "OK",
};

function FlagPill({ flag }: { flag: string }) {
  if (flag === "ok" || flag === "unrated") {
    return <span className="text-xs text-ink/50">{FLAG_LABEL[flag]}</span>;
  }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={
        flag === "severe"
          ? { backgroundColor: FLAME, color: "#fff6ea" }
          : { backgroundColor: "rgba(249, 83, 17, 0.15)", color: FLAME }
      }
    >
      {FLAG_LABEL[flag]}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "active") return null;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={
        status === "suspended"
          ? { backgroundColor: "rgba(17, 17, 17, 0.85)", color: "#fff6ea" }
          : { backgroundColor: "rgba(17, 17, 17, 0.08)" }
      }
    >
      {status === "suspended" ? "Suspended" : "Warned"}
    </span>
  );
}

export function AdminTabs({
  stats,
  reports,
  reportsError,
  flagged,
  flaggedError,
  reviews,
  actionLog,
}: {
  stats: DashboardStats;
  reports: QueueReport[];
  reportsError: string | null;
  flagged: FlaggedUser[];
  flaggedError: string | null;
  reviews: Record<string, ReviewEntry[]>;
  actionLog: ActionLogEntry[];
}) {
  const [tab, setTab] = useState<"reports" | "flagged" | "log">("reports");
  const [openReports, setOpenReports] = useState(reports);

  const TABS = [
    { key: "reports" as const, label: `Reports${openReports.length ? ` (${openReports.length})` : ""}` },
    { key: "flagged" as const, label: `Flagged${flagged.length ? ` (${flagged.length})` : ""}` },
    { key: "log" as const, label: "Log" },
  ];

  return (
    <div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Open reports" value={stats.openReports} />
        <StatTile label="Flagged users" value={stats.flaggedUsers} />
        <StatTile label="Suspended" value={stats.activeSuspensions} />
        <StatTile label="Total users" value={stats.totalUsers} />
      </div>

      <div className="mt-6 mb-6 flex gap-2 border-b border-ink/15">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t.key ? "border-b-2 border-flame text-flame" : "text-ink/60"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "reports" && (
        <ReportList
          reports={openReports}
          error={reportsError}
          onResolved={(id) =>
            setOpenReports((rs) => rs.filter((r) => r.id !== id))
          }
        />
      )}

      {tab === "flagged" && (
        <FlaggedList flagged={flagged} error={flaggedError} reviews={reviews} />
      )}

      {tab === "log" && <ActionLog entries={actionLog} />}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white p-3">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-ink/60">{label}</p>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl border p-4 text-sm"
      style={{ borderColor: FLAME, color: FLAME }}
    >
      {message} — the data could not be loaded, so this list may be incomplete.
    </div>
  );
}

function ReportList({
  reports,
  error,
  onResolved,
}: {
  reports: QueueReport[];
  error: string | null;
  onResolved: (id: string) => void;
}) {
  if (error) return <ErrorNote message={error} />;
  if (!reports.length) {
    return <p className="py-8 text-center text-ink/60">No open reports.</p>;
  }

  return (
    <div className="grid gap-3">
      {reports.map((r) => (
        <ReportRow key={r.id} report={r} onResolved={onResolved} />
      ))}
    </div>
  );
}

function ReportRow({
  report,
  onResolved,
}: {
  report: QueueReport;
  onResolved: (id: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  async function resolve(decision: "actioned" | "dismissed") {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/reports/${report.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Couldn't resolve this report.");
        setBusy(false);
        return;
      }

      onResolved(report.id);
      router.refresh();
    } catch {
      setError("Couldn't resolve this report.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink/15 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{report.reportedName}</span>
        <FlagPill flag={report.reportedFlag} />
        <StatusPill status={report.reportedStatus} />
        {report.reportsAgainstCount > 1 && (
          <span className="text-xs font-medium" style={{ color: FLAME }}>
            {report.reportsAgainstCount} reports total
          </span>
        )}
        <span className="ml-auto text-xs text-ink/50">
          {formatDate(report.createdAt)}
        </span>
      </div>

      <p className="mt-1 text-xs text-ink/50">
        Reported by {report.reporterName}
      </p>

      <p className="mt-3 rounded-lg border border-ink/10 bg-cream/60 px-3 py-2 text-sm">
        {report.reason}
      </p>

      {error && (
        <p className="mt-2 text-sm" style={{ color: FLAME }}>
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => resolve("dismissed")}
          disabled={busy}
          className="rounded-full border border-ink/30 px-3 py-1 text-sm text-ink/70 disabled:opacity-50"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={() => resolve("actioned")}
          disabled={busy}
          className="rounded-full bg-flame px-3 py-1 text-sm font-medium text-cream disabled:opacity-50"
        >
          Mark actioned
        </button>
        <button
          type="button"
          onClick={() => setActing((a) => !a)}
          className="rounded-full border border-flame px-3 py-1 text-sm font-medium"
          style={{ color: FLAME }}
        >
          {acting ? "Cancel" : "Warn / suspend"}
        </button>
      </div>

      {acting && (
        <ActionForm
          targetUserId={report.reportedId}
          targetName={report.reportedName}
          reportId={report.id}
          onDone={() => {
            setActing(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function FlaggedList({
  flagged,
  error,
  reviews,
}: {
  flagged: FlaggedUser[];
  error: string | null;
  reviews: Record<string, ReviewEntry[]>;
}) {
  if (error) return <ErrorNote message={error} />;
  if (!flagged.length) {
    return (
      <div className="py-8 text-center">
        <p className="text-ink/60">No users below the rating threshold.</p>
        <p className="mt-2 text-xs text-ink/50">
          A user is flagged when their shrunk average falls below 3. Because the
          average starts from a neutral prior, a single low rating can never
          flag anyone.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {flagged.map((u) => (
        <FlaggedRow
          key={u.clerkUserId}
          user={u}
          reviews={reviews[u.clerkUserId] ?? []}
        />
      ))}
    </div>
  );
}

function FlaggedRow({
  user,
  reviews,
}: {
  user: FlaggedUser;
  reviews: ReviewEntry[];
}) {
  const router = useRouter();
  const [acting, setActing] = useState(false);
  const [showReviews, setShowReviews] = useState(false);

  const aggregate = { count: user.count, mean: user.mean, adjusted: user.adjusted };

  return (
    <div className="rounded-xl border border-ink/15 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{user.displayName}</span>
        <FlagPill flag={user.flag} />
        <StatusPill status={user.status} />
      </div>

      <div className="mt-2">
        <RatingBadge aggregate={aggregate} size="sm" />
      </div>

      <p className="mt-1 text-xs text-ink/50">
        Shrunk average {user.adjusted.toFixed(2)} — the number the flag fired on
      </p>

      {reviews.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowReviews((s) => !s)}
            className="mt-3 text-sm font-medium hover:underline"
            style={{ color: FLAME }}
          >
            {showReviews ? "Hide" : `Show ${reviews.length} written review${reviews.length === 1 ? "" : "s"}`}
          </button>

          {showReviews && (
            <div className="mt-2 grid gap-2">
              {reviews.map((rev, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-ink/10 bg-cream/60 px-3 py-2 text-sm"
                >
                  <p className="text-xs text-ink/50">
                    {rev.score}★ · {formatDate(rev.createdAt)}
                  </p>
                  <p className="mt-1">{rev.review}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setActing((a) => !a)}
          className="rounded-full border border-flame px-3 py-1 text-sm font-medium"
          style={{ color: FLAME }}
        >
          {acting ? "Cancel" : user.status === "suspended" ? "Lift / act" : "Warn / suspend"}
        </button>
      </div>

      {acting && (
        <ActionForm
          targetUserId={user.clerkUserId}
          targetName={user.displayName}
          reportId={null}
          allowLift={user.status === "suspended"}
          onDone={() => {
            setActing(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ActionForm({
  targetUserId,
  targetName,
  reportId,
  allowLift = false,
  onDone,
}: {
  targetUserId: string;
  targetName: string;
  reportId: string | null;
  allowLift?: boolean;
  onDone: () => void;
}) {
  const [action, setAction] = useState<"warning" | "suspension" | "lift">(
    allowLift ? "lift" : "warning"
  );
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_user_id: targetUserId,
          action,
          reason,
          report_id: reportId,
          ...(action === "suspension" ? { days } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Couldn't record the action.");
        setBusy(false);
        return;
      }

      onDone();
    } catch {
      setError("Couldn't record the action.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-ink/15 bg-cream/60 p-3">
      <p className="text-sm font-medium">Action against {targetName}</p>

      <div className="mt-2 flex flex-wrap gap-2">
        {(["warning", "suspension", ...(allowLift ? (["lift"] as const) : [])] as const).map(
          (a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a)}
              className="rounded-full border px-3 py-1 text-xs font-medium capitalize"
              style={
                action === a
                  ? { backgroundColor: FLAME, borderColor: FLAME, color: "#fff6ea" }
                  : { borderColor: "rgba(17,17,17,0.2)" }
              }
            >
              {a}
            </button>
          )
        )}
      </div>

      {action === "suspension" && (
        <label className="mt-3 block text-xs text-ink/70">
          Length in days (1–{MAX_SUSPENSION_DAYS})
          <input
            type="number"
            min={1}
            max={MAX_SUSPENSION_DAYS}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="mt-1 w-24 rounded-lg border border-ink/20 bg-cream px-2 py-1 text-sm"
          />
        </label>
      )}

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={MAX_REASON_LENGTH}
        rows={3}
        placeholder="Reason (recorded in the action log)"
        className="mt-3 w-full rounded-xl border border-ink/20 bg-cream px-3 py-2 text-sm"
      />

      {error && (
        <p className="mt-2 text-sm" style={{ color: FLAME }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!reason.trim() || busy}
        className="mt-3 rounded-full bg-flame px-4 py-1.5 text-sm font-medium text-cream disabled:opacity-50"
      >
        {busy ? "Recording…" : "Record action"}
      </button>
    </div>
  );
}

function ActionLog({ entries }: { entries: ActionLogEntry[] }) {
  if (!entries.length) {
    return <p className="py-8 text-center text-ink/60">No actions recorded yet.</p>;
  }

  return (
    <div className="grid gap-2">
      {entries.map((a) => (
        <div key={a.id} className="rounded-xl border border-ink/15 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold capitalize">{a.action}</span>
            <span className="text-ink/70">→ {a.targetName}</span>
            {a.expiresAt && (
              <span className="text-xs text-ink/50">
                until {formatDate(a.expiresAt)}
              </span>
            )}
            <span className="ml-auto text-xs text-ink/50">
              {formatDate(a.createdAt)}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink/80">{a.reason}</p>
          <p className="mt-1 text-xs text-ink/50">
            by {a.adminName}
            {a.reportId ? " · from a report" : " · from a rating flag"}
          </p>
        </div>
      ))}
    </div>
  );
}