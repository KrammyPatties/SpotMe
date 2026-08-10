import { describe, expect, it } from "vitest";
import { shouldShowSenderName } from "./chat-view";

const user = (senderId: string | null) => ({ sender_id: senderId, type: "user" });
const system = () => ({ sender_id: null, type: "system" });

const ME = "user_me";
const THEM = "user_them";
const OTHER = "user_other";

describe("shouldShowSenderName", () => {
  it("never labels in a 1:1 room", () => {
    expect(shouldShowSenderName(user(THEM), null, ME, false)).toBe(false);
  });

  it("labels the first message from another member", () => {
    expect(shouldShowSenderName(user(THEM), null, ME, true)).toBe(true);
  });

  it("never labels your own messages", () => {
    expect(shouldShowSenderName(user(ME), null, ME, true)).toBe(false);
  });

  it("never labels system messages", () => {
    expect(shouldShowSenderName(system(), null, ME, true)).toBe(false);
  });

  it("suppresses the label on a consecutive run from one sender", () => {
    expect(shouldShowSenderName(user(THEM), user(THEM), ME, true)).toBe(false);
  });

  it("labels when the sender changes", () => {
    expect(shouldShowSenderName(user(OTHER), user(THEM), ME, true)).toBe(true);
  });

  it("labels after your own message", () => {
    expect(shouldShowSenderName(user(THEM), user(ME), ME, true)).toBe(true);
  });

  it("breaks a run across an intervening system message", () => {
    expect(shouldShowSenderName(user(THEM), system(), ME, true)).toBe(true);
  });
});