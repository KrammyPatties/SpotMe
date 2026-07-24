/**
 * Display-label helpers for enum values stored in the database.
 *
 * Profile enums are stored lowercase snake_case (`intermediate`, `no_preference`,
 * `body_building`) which is correct for storage but unreadable in the UI. These
 * helpers are the single place that translates storage values to display text,
 * used by the match feed, the expanded card, and the requests list (DRY).
 *
 * Pure: no side effects, fully unit-testable.
 */

/**
 * Converts a snake_case enum value to Start Case: `body_building` -> "Body
 * Building". Lowercases the tail of each word so shouty input normalises too.
 */
export function toStartCase(raw: string): string {
  return raw
    .split("_")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/**
 * Turns a stored enum value into display text.
 *
 * `no_preference` is the case that matters: shown raw it reads as a value the
 * user picked rather than the absence of one. With a `context` ("style",
 * "gender", "experience") it renders as "No style preference" - clear about
 * WHAT has no preference. Without context it falls back to "No preference".
 *
 * Null/empty input returns an empty string so callers can render conditionally.
 */
export function toLabel(
  raw: string | null | undefined,
  context?: string,
): string {
  if (raw == null || raw === "") return "";

  if (raw === "no_preference") {
    return context ? `No ${context} preference` : "No preference";
  }

  return toStartCase(raw);
}