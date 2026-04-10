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
    const score = scoreTalk(talk, null, 100);
    expect(score.state).toBe("unknown");
    expect(score.intensity).toBe(0);
  });

  it("returns unknown when followCount is 0", () => {
    const score = scoreTalk(talk, { a: makeMention(5) }, 0);
    expect(score.state).toBe("unknown");
  });

  it("returns unknown when the talk has no mention entry (out of crawl scope)", () => {
    const score = scoreTalk(talk, {}, 100);
    expect(score.state).toBe("unknown");
  });

  it("returns missed when uniqueFollows is 0 but talk is in scope", () => {
    const score = scoreTalk(talk, { a: makeMention(0) }, 100);
    expect(score.state).toBe("missed");
    expect(score.intensity).toBeCloseTo(1.0, 6);
  });

  it("returns engaged when at least one follow engaged", () => {
    const score = scoreTalk(talk, { a: makeMention(3) }, 100);
    expect(score.state).toBe("engaged");
    expect(score.intensity).toBeCloseTo(0.97, 6);
  });

  it("returns unknown when followCount is negative", () => {
    const score = scoreTalk(talk, { a: makeMention(5) }, -3);
    expect(score.state).toBe("unknown");
    // totalFollows is sanitized to 0, not the bogus -3, so JSON serialization
    // and downstream consumers see a stable shape.
    expect(score.layer1.totalFollows).toBe(0);
  });

  it("returns unknown when followCount is NaN", () => {
    const score = scoreTalk(talk, { a: makeMention(5) }, Number.NaN);
    expect(score.state).toBe("unknown");
    expect(score.layer1.totalFollows).toBe(0);
  });

  it("returns unknown when followCount is +Infinity", () => {
    const score = scoreTalk(
      talk,
      { a: makeMention(5) },
      Number.POSITIVE_INFINITY,
    );
    expect(score.state).toBe("unknown");
    expect(score.layer1.totalFollows).toBe(0);
  });

  it("returns unknown when followCount is -Infinity", () => {
    const score = scoreTalk(
      talk,
      { a: makeMention(5) },
      Number.NEGATIVE_INFINITY,
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
    const score = scoreTalk(talk, mentions, 100);
    expect(score.intensity).toBeCloseTo(1.0, 6);
  });

  it("uses DEFAULT_ACTIVE_LAYERS when active omitted but explicit weights supplied", () => {
    const score = scoreTalk(talk, mentions, 100, {
      surpriseSlider: 0.25,
      friendsSlider: 0.75,
    });
    // active defaults to both-off → L1-only branch → weights don't enter
    // the math at all → intensity == layer1.attentionInverse == 1.0
    expect(score.intensity).toBeCloseTo(1.0, 6);
  });

  it("uses DEFAULT_WEIGHTS when weights omitted but explicit active supplied", () => {
    const score = scoreTalk(talk, mentions, 100, undefined, {
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
      aaa: makeMention(1),   // engaged, intensity 0.99
      bbb: makeMention(0),   // missed,  intensity 1.0
      ccc: makeMention(50),  // engaged, intensity 0.5
      // D, E: no mentions → unknown
    };
    const result = rankTalks({
      talks: [A, B, C, D, E],
      mentions,
      followCount: 100,
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
      active,
    });
    // L1 only contributes; L2 stub returns 0; rescale: 0.5/0.8 = 0.625
    expect(result[0].intensity).toBeCloseTo(0.625, 6);
  });
});

describe("rankTalks — empty / degenerate inputs", () => {
  it("returns [] for empty talks array", () => {
    const result = rankTalks({
      talks: [],
      mentions: {},
      followCount: 100,
    });
    expect(result).toEqual([]);
  });

  it("returns all unknown sorted by rkey when mentions is null", () => {
    const result = rankTalks({
      talks: [makeTalk("ccc"), makeTalk("aaa"), makeTalk("bbb")],
      mentions: null,
      followCount: 100,
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
    });
    expect(result.map((s) => s.state)).toEqual(["unknown", "unknown", "unknown"]);
  });
});
