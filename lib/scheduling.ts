import { isUuid } from "@/lib/uuid";

// Types

export type SessionProposal = {
  chatroom_id: string;
  starts_at: string; // normalised ISO (UTC) on the way out
  ends_at: string; // normalised ISO (UTC) on the way out
  gym_id: string | null;
};

export type ValidationResult =
  | { ok: true; value: SessionProposal }
  | { ok: false; error: string };

// Validation

const MIN_DURATION_MIN = 15;
const MAX_DURATION_MIN = 480; // 8 hours
const MAX_DAYS_AHEAD = 180;

/**
 * Validate an untrusted session proposal.
 * On success, returns a proposal with starts_at/ends_at normalised to
 * canonical UTC ISO strings, so every row lands in one format regardless of
 * the offset the client sent.
 */
export function validateSessionProposal(
  payload: unknown,
  now: Date = new Date()
): ValidationResult {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Payload must be an object" };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.chatroom_id !== "string" || !isUuid(p.chatroom_id)) {
    return { ok: false, error: "chatroom_id must be a valid UUID" };
  }

  if (typeof p.starts_at !== "string" || typeof p.ends_at !== "string") {
    return { ok: false, error: "starts_at and ends_at must be ISO strings" };
  }

  const start = new Date(p.starts_at);
  const end = new Date(p.ends_at);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, error: "starts_at and ends_at must be valid dates" };
  }

  if (end <= start) {
    return { ok: false, error: "Session must end after it starts" };
  }

  if (start <= now) {
    return { ok: false, error: "Session must be in the future" };
  }

  const durationMin = (end.getTime() - start.getTime()) / 60000;

  if (durationMin < MIN_DURATION_MIN) {
    return {
      ok: false,
      error: `Session must be at least ${MIN_DURATION_MIN} minutes`,
    };
  }

  if (durationMin > MAX_DURATION_MIN) {
    return {
      ok: false,
      error: `Session cannot exceed ${MAX_DURATION_MIN / 60} hours`,
    };
  }

  const daysAhead = (start.getTime() - now.getTime()) / 86400000;

  if (daysAhead > MAX_DAYS_AHEAD) {
    return {
      ok: false,
      error: `Session cannot be more than ${MAX_DAYS_AHEAD} days ahead`,
    };
  }

  if (p.gym_id !== null && (typeof p.gym_id !== "string" || !isUuid(p.gym_id))) {
    return { ok: false, error: "gym_id must be a valid UUID or null" };
  }

  return {
    ok: true,
    value: {
      chatroom_id: p.chatroom_id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      gym_id: (p.gym_id as string | null) ?? null,
    },
  };
}

export type ConfirmationStatus = "going" | "out";

export type Confirmation = {
  user_id: string;
  status: ConfirmationStatus;
};

export type DerivedStatus = "proposed" | "confirmed" | "cancelled";

export function deriveSessionStatus(
  proposerId: string,
  confirmations: Confirmation[]
): DerivedStatus {
  const going = confirmations.filter((c) => c.status === "going");
  if (going.length === 0) return "cancelled";
  if (going.some((c) => c.user_id !== proposerId)) return "confirmed";
  return "proposed";
}

// ICS generation (RFC 5545)

export type IcsEvent = {
  uid: string; // the session's row id which must be globally unique
  starts_at: string;
  ends_at: string;
  summary: string;
  location?: string;
  description?: string;
  created_at: string; // used for DTSTAMP
};

export function buildIcs(event: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SpotMe//Workout Session//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}@spotme-phi.vercel.app`,
    `DTSTAMP:${toIcsDate(event.created_at)}`,
    `DTSTART:${toIcsDate(event.starts_at)}`,
    `DTEND:${toIcsDate(event.ends_at)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
  ];

  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function toIcsDate(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;

  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);

  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }

  parts.push(" " + rest);
  return parts.join("\r\n");
}