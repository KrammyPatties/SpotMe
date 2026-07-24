import { describe, it, expect } from "vitest";
import { buildAvailabilityGrid } from "./availability";

describe("buildAvailabilityGrid", () => {
  const candidate = [
    { day: 0, time: "morning" },
    { day: 1, time: "evening" },
  ];

  it("marks a slot both people share", () => {
    const grid = buildAvailabilityGrid(candidate, [{ day: 0, time: "morning" }]);
    expect(grid[0][0]).toBe("shared");
  });

  it("marks a candidate-only slot", () => {
    const grid = buildAvailabilityGrid(candidate, [{ day: 0, time: "morning" }]);
    expect(grid[1][2]).toBe("candidate");
  });

  it("leaves slots the candidate isn't free as none", () => {
    const grid = buildAvailabilityGrid(candidate, [{ day: 0, time: "morning" }]);
    expect(grid[0][1]).toBe("none");
    expect(grid[1][0]).toBe("none");
  });

  it("returns a 7x3 grid", () => {
    const grid = buildAvailabilityGrid(candidate, []);
    expect(grid).toHaveLength(7);
    expect(grid.every((row) => row.length === 3)).toBe(true);
  });

  it("shows nothing when the candidate has no availability", () => {
    const grid = buildAvailabilityGrid([], [{ day: 0, time: "morning" }]);
    expect(grid.flat().every((c) => c === "none")).toBe(true);
  });

  it("never marks shared when the user has no availability", () => {
    const grid = buildAvailabilityGrid(candidate, []);
    expect(grid.flat().some((c) => c === "shared")).toBe(false);
    expect(grid[0][0]).toBe("candidate");
  });

  it("marks every slot shared on full overlap", () => {
    const grid = buildAvailabilityGrid(candidate, candidate);
    expect(grid[0][0]).toBe("shared");
    expect(grid[1][2]).toBe("shared");
  });
});