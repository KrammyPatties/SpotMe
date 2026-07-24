import { describe, it, expect } from "vitest";
import { toLabel, toStartCase } from "./labels";

describe("toStartCase", () => {
  it("capitalises a single word", () => {
    expect(toStartCase("beginner")).toBe("Beginner");
  });

  it("splits and capitalises snake_case", () => {
    expect(toStartCase("body_building")).toBe("Body Building");
  });

  it("handles multi-part enums", () => {
    expect(toStartCase("prefer_not_to_say")).toBe("Prefer Not To Say");
  });

  it("normalises already-uppercase input", () => {
    expect(toStartCase("BEGINNER")).toBe("Beginner");
  });
});

describe("toLabel", () => {
  it("start-cases ordinary enum values", () => {
    expect(toLabel("intermediate")).toBe("Intermediate");
    expect(toLabel("powerlifting")).toBe("Powerlifting");
    expect(toLabel("female")).toBe("Female");
  });

  it("renders no_preference with context", () => {
    expect(toLabel("no_preference", "style")).toBe("No style preference");
    expect(toLabel("no_preference", "gender")).toBe("No gender preference");
  });

  it("renders no_preference without context", () => {
    expect(toLabel("no_preference")).toBe("No preference");
  });

  it("returns an empty string for null or empty input", () => {
    expect(toLabel(null)).toBe("");
    expect(toLabel(undefined)).toBe("");
    expect(toLabel("")).toBe("");
  });
});