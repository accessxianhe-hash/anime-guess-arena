import { describe, expect, it } from "vitest";

import {
  calculateAccuracy,
  calculateDurationMs,
} from "@/lib/leaderboard";
import { toDateKey } from "@/lib/timezone";

describe("leaderboard helpers", () => {
  it("calculates accuracy safely", () => {
    expect(calculateAccuracy(0, 0)).toBe(0);
    expect(calculateAccuracy(7, 10)).toBe(0.7);
  });

  it("caps duration at the session expiry", () => {
    const startedAt = new Date("2026-03-28T12:00:00.000Z");
    const expiresAt = new Date("2026-03-28T12:01:00.000Z");
    const finishedAt = new Date("2026-03-28T12:05:00.000Z");

    expect(calculateDurationMs(startedAt, finishedAt, expiresAt)).toBe(60_000);
  });

  it("formats date keys using timezone", () => {
    expect(toDateKey(new Date("2026-03-28T16:30:00.000Z"), "Asia/Shanghai")).toBe(
      "2026-03-29",
    );
  });
});
