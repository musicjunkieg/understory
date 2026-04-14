import { describe, expect, it } from "vitest";
import { computeLayer2 } from "./interest";
import type { TalkEntry } from "@/lib/types";

function makeTalk(rkey: string): TalkEntry {
  return {
    rkey,
    title: `Talk ${rkey}`,
    vodUri: `at://example/${rkey}`,
    vodCid: "bafy",
    hlsUrl: "",
    durationMs: 0,
    createdAt: "",
    eventUri: `at://event/${rkey}`,
    description: null,
    speakers: [],
    room: null,
    talkType: null,
    category: null,
    startsAt: null,
    endsAt: null,
    transcriptFile: null,
  };
}

const RKEY = "3mi54oonum62b";

describe("computeLayer2", () => {
  it("returns interestScore 1.0 for identical vectors", () => {
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, [1, 0, 0], { [RKEY]: [1, 0, 0] });
    expect(result.interestScore).toBeCloseTo(1.0, 10);
  });

  it("returns interestScore 0.5 for orthogonal vectors", () => {
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, [1, 0, 0], { [RKEY]: [0, 1, 0] });
    expect(result.interestScore).toBeCloseTo(0.5, 10);
  });

  it("returns interestScore 0 for opposite vectors", () => {
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, [1, 0, 0], { [RKEY]: [-1, 0, 0] });
    expect(result.interestScore).toBeCloseTo(0, 10);
  });

  it("returns interestScore 0 when the user vector is null", () => {
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, null, { [RKEY]: [1, 0, 0] });
    expect(result.interestScore).toBe(0);
  });

  it("returns interestScore 0 when the talk has no embedding on disk", () => {
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, [1, 0, 0], {});
    expect(result.interestScore).toBe(0);
  });

  it("returns interestScore 0.5 when the talk vector has zero magnitude", () => {
    // cosineSimilarity returns 0 on zero-magnitude inputs (contract from #21),
    // so shift-and-scale gives us 0.5 (neutral). Not a special case — just
    // the math falling through naturally.
    const talk = makeTalk(RKEY);
    const result = computeLayer2(talk, [1, 2, 3], { [RKEY]: [0, 0, 0] });
    expect(result.interestScore).toBeCloseTo(0.5, 10);
  });

  it("throws with the cosine length-mismatch message on dimension mismatch", () => {
    // cosineSimilarity throws "cosine: length mismatch A vs B" (contract
    // pinned in #21's cosine.test.ts). computeLayer2 must NOT catch — a
    // dimension mismatch is a real bug, not a recoverable runtime state.
    const talk = makeTalk(RKEY);
    expect(() =>
      computeLayer2(talk, [1, 0, 0], { [RKEY]: [1, 0] }),
    ).toThrow("cosine: length mismatch 3 vs 2");
  });
});
