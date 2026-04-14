import { describe, it, expect } from "vitest";
import { scoreTalk, rankTalks } from "./rank";
import { DEFAULT_WEIGHTS } from "./types";
import { DEFAULT_ACTIVE_LAYERS, type ActiveLayers } from "./combine";
import type { TalkEntry } from "@/lib/types";
import type { TalkMention, TalkMentions } from "@/lib/crawl/types";

function makeTalk(rkey: string, overrides: Partial<TalkEntry> = {}): TalkEntry {
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
    ...overrides,
  };
}

// Build a TalkMention with `n` distinct follow DIDs (engaged follows for
// this talk, NOT the user's total follow count — that's a separate arg).
function makeMention(n: number): TalkMention {
  const follows = Array.from({ length: n }, (_, i) => `did:plc:f${i}`);
  return {
    count: n,
    follows,
    posts: [],
    rsvps: [],
  };
}

describe("scoreTalk — state derivation", () => {
  const talk = makeTalk("a");

  it("returns unknown when mentions is null", () => {
    const score = scoreTalk(talk, null, 100, null, {});
    expect(score.state).toBe("unknown");
    expect(score.intensity).toBe(0);
  });

  it("returns unknown when followCount is 0", () => {
    const score = scoreTalk(talk, { a: makeMention(5) }, 0, null, {});
    expect(score.state).toBe("unknown");
  });

  it("returns unknown when the talk has no mention entry (out of crawl scope)", () => {
    const score = scoreTalk(talk, {}, 100, null, {});
    expect(score.state).toBe("unknown");
  });

  it("returns missed when uniqueFollows is 0 but talk is in scope", () => {
    const score = scoreTalk(talk, { a: makeMention(0) }, 100, null, {});
    expect(score.state).toBe("missed");
    expect(score.intensity).toBeCloseTo(1.0, 6);
  });

  it("returns engaged when at least one follow engaged", () => {
    const score = scoreTalk(talk, { a: makeMention(3) }, 100, null, {});
    expect(score.state).toBe("engaged");
    expect(score.intensity).toBeCloseTo(0.97, 6);
  });

  it("returns unknown when followCount is negative", () => {
    const score = scoreTalk(talk, { a: makeMention(5) }, -3, null, {});
    expect(score.state).toBe("unknown");
    // totalFollows is sanitized to 0, not the bogus -3, so JSON serialization
    // and downstream consumers see a stable shape.
    expect(score.layer1.totalFollows).toBe(0);
  });

  it("returns unknown when followCount is NaN", () => {
    const score = scoreTalk(talk, { a: makeMention(5) }, Number.NaN, null, {});
    expect(score.state).toBe("unknown");
    expect(score.layer1.totalFollows).toBe(0);
  });

  it("returns unknown when followCount is +Infinity", () => {
    const score = scoreTalk(
      talk,
      { a: makeMention(5) },
      Number.POSITIVE_INFINITY,
      null,
      {},
    );
    expect(score.state).toBe("unknown");
    expect(score.layer1.totalFollows).toBe(0);
  });

  it("returns unknown when followCount is -Infinity", () => {
    const score = scoreTalk(
      talk,
      { a: makeMention(5) },
      Number.NEGATIVE_INFINITY,
      null,
      {},
    );
    expect(score.state).toBe("unknown");
    expect(score.layer1.totalFollows).toBe(0);
  });
});

describe("DEFAULT_WEIGHTS / DEFAULT_ACTIVE_LAYERS — frozen sentinels", () => {
  it("DEFAULT_WEIGHTS is frozen so accidental mutation throws or no-ops", () => {
    // Object.freeze makes assignment a silent no-op in sloppy mode and throws
    // in strict mode. Either way, the value cannot change.
    expect(Object.isFrozen(DEFAULT_WEIGHTS)).toBe(true);
  });

  it("DEFAULT_ACTIVE_LAYERS is frozen so accidental mutation throws or no-ops", () => {
    expect(Object.isFrozen(DEFAULT_ACTIVE_LAYERS)).toBe(true);
  });
});

describe("scoreTalk — defaults", () => {
  const talk = makeTalk("a");
  const mentions: TalkMentions = { a: makeMention(0) };

  it("uses both DEFAULT_WEIGHTS and DEFAULT_ACTIVE_LAYERS when both omitted", () => {
    const score = scoreTalk(talk, mentions, 100, null, {});
    expect(score.intensity).toBeCloseTo(1.0, 6);
  });

  it("uses DEFAULT_ACTIVE_LAYERS when active omitted but explicit weights supplied", () => {
    const score = scoreTalk(talk, mentions, 100, null, {}, {
      surpriseSlider: 0.25,
      friendsSlider: 0.75,
    });
    // active defaults to both-off → L1-only branch → weights don't enter
    // the math at all → intensity == layer1.attentionInverse == 1.0
    expect(score.intensity).toBeCloseTo(1.0, 6);
  });

  it("uses DEFAULT_WEIGHTS when weights omitted but explicit active supplied", () => {
    const score = scoreTalk(talk, mentions, 100, null, {}, undefined, {
      layer2: true,
      layer3: false,
    });
    // L1+L2 active, L2 stub returns 0, default surprise=0.5
    // (1.0*0.5 + 0*0.5*0.3) / 0.8 = 0.625
    expect(score.intensity).toBeCloseTo(0.625, 6);
  });
});

describe("rankTalks — sort order", () => {
  const A = makeTalk("aaa");
  const B = makeTalk("bbb");
  const C = makeTalk("ccc");
  const D = makeTalk("ddd");
  const E = makeTalk("eee");

  it("sorts missed first, then engaged (intensity desc), then unknown", () => {
    const mentions: TalkMentions = {
      aaa: makeMention(1),   // engaged, normalized intensity 0.98 (1/50 engaged)
      bbb: makeMention(0),   // missed,  intensity 1.0
      ccc: makeMention(50),  // engaged, normalized intensity 0.0 (50/50 engaged)
      // D, E: no mentions → unknown
    };
    const result = rankTalks({
      talks: [A, B, C, D, E],
      mentions,
      followCount: 100,
      interestVector: null,
      embeddings: {},
    });

    expect(result.map((s) => s.rkey)).toEqual(["bbb", "aaa", "ccc", "ddd", "eee"]);
  });

  it("uses rkey ascending as a deterministic tiebreak", () => {
    const Z = makeTalk("zzz");
    const A = makeTalk("aaa");
    const mentions: TalkMentions = {
      zzz: makeMention(0),
      aaa: makeMention(0),
    };
    const result = rankTalks({
      talks: [Z, A], // intentionally not in rkey order
      mentions,
      followCount: 100,
      interestVector: null,
      embeddings: {},
    });

    // Both missed with intensity 1.0; tiebreak puts "aaa" before "zzz"
    expect(result[0].rkey).toBe("aaa");
    expect(result[1].rkey).toBe("zzz");
  });

  it("threads weights and active flags through to combineLayers", () => {
    const active: ActiveLayers = { layer2: true, layer3: false };
    const mentions: TalkMentions = { aaa: makeMention(0) };
    const result = rankTalks({
      talks: [A],
      mentions,
      followCount: 100,
      interestVector: null,
      embeddings: {},
      active,
    });
    // L1 only contributes; L2 stub returns 0; rescale: 0.5/0.8 = 0.625
    expect(result[0].intensity).toBeCloseTo(0.625, 6);
  });
});

describe("rankTalks — engaged-follow normalization", () => {
  it("normalizes intensity against engaged follows, not total follows", () => {
    // 200 total follows, but only 10 unique follows engaged with any talk.
    // Without normalization, all talks cluster near intensity 1.0.
    // With normalization, the spread covers the full 0–1 range.
    const mentions: TalkMentions = {
      aaa: makeMention(0),   // missed: 0/10 → intensity 1.0
      bbb: makeMention(2),   // engaged: 2/10 → intensity 0.8
      ccc: makeMention(10),  // engaged: 10/10 → intensity 0.0
    };
    const result = rankTalks({
      talks: [makeTalk("aaa"), makeTalk("bbb"), makeTalk("ccc")],
      mentions,
      followCount: 200,
      interestVector: null,
      embeddings: {},
    });

    const byRkey = Object.fromEntries(result.map((s) => [s.rkey, s]));
    expect(byRkey.aaa.intensity).toBeCloseTo(1.0, 6);
    expect(byRkey.bbb.intensity).toBeCloseTo(0.8, 6);
    expect(byRkey.ccc.intensity).toBeCloseTo(0.0, 6);
    // Raw layer1 values are preserved (totalFollows stays as original followCount)
    expect(byRkey.bbb.layer1.totalFollows).toBe(200);
    // normalizedCoverage set for non-unknown talks (fraction who discussed it)
    expect(byRkey.aaa.normalizedCoverage).toBe(0);    // missed: 0/10
    expect(byRkey.bbb.normalizedCoverage).toBeCloseTo(0.2, 6); // 2/10
    expect(byRkey.ccc.normalizedCoverage).toBeCloseTo(1.0, 6); // 10/10
  });

  it("skips normalization when no follows engaged (all missed)", () => {
    const mentions: TalkMentions = {
      aaa: makeMention(0),
      bbb: makeMention(0),
    };
    const result = rankTalks({
      talks: [makeTalk("aaa"), makeTalk("bbb")],
      mentions,
      followCount: 100,
      interestVector: null,
      embeddings: {},
    });

    // No engaged follows → no normalization → original totalFollows preserved
    expect(result[0].layer1.totalFollows).toBe(100);
    expect(result[0].intensity).toBeCloseTo(1.0, 6);
  });
});

describe("rankTalks — empty / degenerate inputs", () => {
  it("returns [] for empty talks array", () => {
    const result = rankTalks({
      talks: [],
      mentions: {},
      followCount: 100,
      interestVector: null,
      embeddings: {},
    });
    expect(result).toEqual([]);
  });

  it("returns all unknown sorted by rkey when mentions is null", () => {
    const result = rankTalks({
      talks: [makeTalk("ccc"), makeTalk("aaa"), makeTalk("bbb")],
      mentions: null,
      followCount: 100,
      interestVector: null,
      embeddings: {},
    });
    expect(result.map((s) => s.state)).toEqual(["unknown", "unknown", "unknown"]);
    expect(result.map((s) => s.rkey)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("returns all unknown when followCount is 0", () => {
    const result = rankTalks({
      talks: [makeTalk("aaa"), makeTalk("bbb"), makeTalk("ccc")],
      mentions: {
        aaa: makeMention(5),
        bbb: makeMention(10),
        ccc: makeMention(0),
      },
      followCount: 0,
      interestVector: null,
      embeddings: {},
    });
    expect(result.map((s) => s.state)).toEqual(["unknown", "unknown", "unknown"]);
  });
});

describe("rankTalks — layer 2 integration", () => {
  const RKEY_A = "3mi54oonum62b";
  const RKEY_B = "3mi56m3hnrq2z";

  it("blends layer 2 into the final intensity when active.layer2 is true", () => {
    const talks = [makeTalk(RKEY_A), makeTalk(RKEY_B)];

    // Both talks have identical layer-1 data: 5 follows mentioned each.
    const mentions: TalkMentions = {
      [RKEY_A]: {
        count: 5,
        follows: ["did:plc:a", "did:plc:b", "did:plc:c", "did:plc:d", "did:plc:e"],
        posts: [],
        rsvps: [],
      },
      [RKEY_B]: {
        count: 5,
        follows: ["did:plc:a", "did:plc:b", "did:plc:c", "did:plc:d", "did:plc:e"],
        posts: [],
        rsvps: [],
      },
    };

    // Layer 2 differentiator: RKEY_A is a perfect match for the user's
    // interest vector, RKEY_B is the opposite.
    const result = rankTalks({
      talks,
      mentions,
      followCount: 10,
      interestVector: [1, 0, 0],
      embeddings: {
        [RKEY_A]: [1, 0, 0], // perfect match → interestScore 1.0
        [RKEY_B]: [-1, 0, 0], // opposite → interestScore 0.0
      },
      active: { layer2: true, layer3: false },
    });

    // RKEY_A should rank first because layer 2 lifts it above RKEY_B
    // even though their layer-1 scores are identical.
    expect(result[0].rkey).toBe(RKEY_A);
    expect(result[1].rkey).toBe(RKEY_B);

    // Sanity: layer 2 results are stashed on TalkScore.
    const scoreA = result.find((s) => s.rkey === RKEY_A)!;
    const scoreB = result.find((s) => s.rkey === RKEY_B)!;
    expect(scoreA.layer2.interestScore).toBeCloseTo(1.0, 10);
    expect(scoreB.layer2.interestScore).toBeCloseTo(0.0, 10);
  });

  it("rescales layer 2 relative to the observed distribution", () => {
    // Real voyage-3.5-lite cosines on in-domain content cluster tightly
    // (e.g. [0.2, 0.6]), which shift-and-scale maps to interestScore in
    // [0.6, 0.8]. Without relative normalization that compresses the
    // layer-2 contribution to 0.375 * 0.2 = 0.075 of the intensity range
    // — barely visible against the cubic opacity curve. This test fakes
    // that clustering and asserts the full w2 weight (0.375) is
    // recovered via min-max rescale over the scored talks.
    const RKEY_HI = "3mi54aaaaaaa";
    const RKEY_MID = "3mi54bbbbbbb";
    const RKEY_LO = "3mi54ccccccc";

    const talks = [makeTalk(RKEY_HI), makeTalk(RKEY_MID), makeTalk(RKEY_LO)];
    const follows = ["did:plc:a", "did:plc:b", "did:plc:c"];
    const mention: TalkMention = {
      count: 3,
      follows,
      posts: [],
      rsvps: [],
    };
    const mentions: TalkMentions = {
      [RKEY_HI]: mention,
      [RKEY_MID]: mention,
      [RKEY_LO]: mention,
    };

    // Construct embeddings whose shift-and-scale cosines land on 0.8,
    // 0.7, 0.6 — tightly clustered, all positive. This mimics the
    // production regime where real embeddings rarely produce negative
    // cosines.
    const interestVector = [1, 0];
    const embeddings: Record<string, number[]> = {
      // cosine 0.6 → interestScore 0.8
      [RKEY_HI]: [0.6, Math.sqrt(1 - 0.36)],
      // cosine 0.4 → interestScore 0.7
      [RKEY_MID]: [0.4, Math.sqrt(1 - 0.16)],
      // cosine 0.2 → interestScore 0.6
      [RKEY_LO]: [0.2, Math.sqrt(1 - 0.04)],
    };

    const result = rankTalks({
      talks,
      mentions,
      followCount: 10,
      interestVector,
      embeddings,
      active: { layer2: true, layer3: false },
    });

    // All three talks share identical layer-1 data, so the entire
    // intensity spread comes from layer 2. With relative normalization,
    // the HI talk's normalized layer2 is 1.0 and the LO talk's is 0.0.
    // The effective contribution per unit is w2 * (1 - surpriseSlider)
    // = 0.375 * (1 - 0.5) = 0.1875 under DEFAULT_WEIGHTS, so the
    // HI-to-LO intensity delta should be 0.1875. Without relative
    // normalization this would be 0.1875 * 0.2 = 0.0375 — barely a
    // visible spread through the cubic opacity curve.
    const hi = result.find((s) => s.rkey === RKEY_HI)!;
    const lo = result.find((s) => s.rkey === RKEY_LO)!;
    expect(hi.intensity - lo.intensity).toBeCloseTo(0.1875, 10);
  });

  it("handles a degenerate layer-2 distribution without NaN", () => {
    // When every talk has the same layer2 value (e.g. interestVector is
    // null and every interestScore is 0), min == max and the rescale
    // denominator is zero. Verify rank.ts doesn't divide by zero.
    const talks = [makeTalk(RKEY_A), makeTalk(RKEY_B)];
    const follows = ["did:plc:a", "did:plc:b", "did:plc:c"];
    const mention: TalkMention = { count: 3, follows, posts: [], rsvps: [] };
    const mentions: TalkMentions = {
      [RKEY_A]: mention,
      [RKEY_B]: mention,
    };

    const result = rankTalks({
      talks,
      mentions,
      followCount: 10,
      interestVector: null,
      embeddings: {},
      active: { layer2: true, layer3: false },
    });

    for (const s of result) {
      expect(Number.isFinite(s.intensity)).toBe(true);
    }
  });
});
