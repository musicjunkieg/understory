import { describe, it, expect } from "vitest";
import { computeLayer1 } from "./networkAttention";
import type { TalkMention } from "@/lib/crawl/types";

// Build a TalkMention with `n` distinct follow DIDs.
// Note: this is "follows engaged with this talk", NOT the user's total
// follow count — that's passed separately as the second arg to computeLayer1.
function makeMention(n: number): TalkMention {
  const follows = Array.from({ length: n }, (_, i) => `did:plc:f${i}`);
  return {
    count: n,
    follows,
    posts: [],
    rsvps: [],
  };
}

describe("computeLayer1", () => {
  it("returns attentionInverse 1.0 when zero follows engaged", () => {
    const result = computeLayer1(makeMention(0), 100);
    expect(result.uniqueFollows).toBe(0);
    expect(result.totalFollows).toBe(100);
    expect(result.reachRatio).toBeCloseTo(0, 6);
    expect(result.attentionInverse).toBeCloseTo(1.0, 6);
  });

  it("returns attentionInverse 0.5 when half engaged", () => {
    const result = computeLayer1(makeMention(50), 100);
    expect(result.reachRatio).toBeCloseTo(0.5, 6);
    expect(result.attentionInverse).toBeCloseTo(0.5, 6);
  });

  it("returns attentionInverse 0.0 when fully engaged", () => {
    const result = computeLayer1(makeMention(100), 100);
    expect(result.reachRatio).toBeCloseTo(1.0, 6);
    expect(result.attentionInverse).toBeCloseTo(0.0, 6);
  });

  it("returns attentionInverse 1.0 when followCount is 0 (divide-by-zero guard)", () => {
    const result = computeLayer1(makeMention(3), 0);
    expect(result.reachRatio).toBeCloseTo(0, 6);
    expect(result.attentionInverse).toBeCloseTo(1.0, 6);
  });

  it("clamps reachRatio to 1 when stale data has more follows than followCount", () => {
    const result = computeLayer1(makeMention(110), 100);
    expect(result.reachRatio).toBeCloseTo(1.0, 6);
    expect(result.attentionInverse).toBeCloseTo(0.0, 6);
  });

  it("treats undefined mention as zero engagement", () => {
    const result = computeLayer1(undefined, 100);
    expect(result.uniqueFollows).toBe(0);
    expect(result.attentionInverse).toBeCloseTo(1.0, 6);
  });
});
