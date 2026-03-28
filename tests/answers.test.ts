import { Difficulty } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  calculateQuestionScore,
  isAnswerCorrect,
  normalizeAnswer,
  normalizeNickname,
  splitPipeList,
} from "@/lib/answers";

describe("answers helpers", () => {
  it("normalizes spacing and casing", () => {
    expect(normalizeAnswer(" One   Piece ")).toBe("onepiece");
  });

  it("matches aliases after normalization", () => {
    expect(
      isAnswerCorrect("  naruto ", "火影忍者", ["Naruto", "ナルト"]),
    ).toBe(true);
  });

  it("rejects unrelated titles", () => {
    expect(
      isAnswerCorrect("Bleach", "进击的巨人", ["Attack on Titan", "AOT"]),
    ).toBe(false);
  });

  it("splits pipe lists", () => {
    expect(splitPipeList("A|B| C ")).toEqual(["A", "B", "C"]);
  });

  it("keeps nickname punctuation while normalizing case", () => {
    expect(normalizeNickname(" Ace-01 ")).toBe("ace-01");
  });

  it("returns difficulty score values", () => {
    expect(calculateQuestionScore(Difficulty.EASY)).toBe(10);
    expect(calculateQuestionScore(Difficulty.MEDIUM)).toBe(20);
    expect(calculateQuestionScore(Difficulty.HARD)).toBe(30);
  });
});
