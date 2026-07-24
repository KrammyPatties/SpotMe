/**
 * Availability grid helpers for the match card.
 *
 * The expanded card replaces a long comma-joined slot list with a 7x3 grid
 * (days x times-of-day), where cells are shaded by whether the candidate's
 * free slot also overlaps the viewing user's — turning "when is this person
 * free" into a one-glance comparison of "when can WE actually meet".
 *
 * Pure: no side effects, fully unit-testable.
 */

/** Day indices, 0 = Sunday (matches the `day_of_week` column convention). */
export const GRID_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const GRID_TIMES = ["morning", "afternoon", "evening"] as const;
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const TIME_LABELS = ["Mor", "Aft", "Eve"];

/** One cell's state:
 *  - "shared"    both people are free (solid flame - you can actually meet)
 *  - "candidate" only the candidate is free (translucent flame)
 *  - "none"      the candidate isn't free then (empty) */
export type SlotState = "shared" | "candidate" | "none";

/** An availability slot as stored on a profile. */
export type Slot = { day: number; time: string };

export function buildAvailabilityGrid(
  candidateAvailability: Slot[],
  userAvailability: Slot[],
): SlotState[][] {
  const candidateSlots = new Set(
    candidateAvailability.map((a) => `${a.day}-${a.time}`),
  );
  const userSlots = new Set(
    userAvailability.map((a) => `${a.day}-${a.time}`),
  );

  return GRID_DAYS.map((day) =>
    GRID_TIMES.map((time) => {
      const key = `${day}-${time}`;
      if (!candidateSlots.has(key)) return "none";
      return userSlots.has(key) ? "shared" : "candidate";
    }),
  );
}