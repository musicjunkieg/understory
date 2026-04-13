import { describe, expect, it } from "vitest";
import type { AppBskyFeedDefs } from "@atproto/api";
import {
  filterFeedItems,
  MAX_AGE_MS,
  meanPool,
  validateVoyageResponse,
  type VoyageEmbedResponse,
} from "./interest-profile";

type FeedViewPost = AppBskyFeedDefs.FeedViewPost;

const USER_DID = "did:plc:self";
const OTHER_DID = "did:plc:other";

/**
 * Minimal factory for a FeedViewPost the filter cares about. The filter
 * only reads: .post.author.did, .post.indexedAt, .post.record.text,
 * .reply?.parent, .reason.$type. Everything else is cast through `unknown`
 * to keep the fixture concise.
 */
function makeFeedItem(opts: {
  authorDid?: string;
  indexedAt?: string;
  text?: string;
  repost?: boolean;
  replyParentAuthor?: string | null; // null = no reply, string = parent author DID
}): FeedViewPost {
  const {
    authorDid = USER_DID,
    indexedAt = new Date().toISOString(),
    text = "hello world",
    repost = false,
    replyParentAuthor = null,
  } = opts;

  const item: Record<string, unknown> = {
    post: {
      $type: "app.bsky.feed.defs#postView",
      uri: `at://${authorDid}/app.bsky.feed.post/${Math.random()}`,
      cid: "bafytest",
      author: { did: authorDid, handle: "test.bsky.social" },
      record: { $type: "app.bsky.feed.post", text, createdAt: indexedAt },
      indexedAt,
    },
  };

  if (repost) {
    item.reason = {
      $type: "app.bsky.feed.defs#reasonRepost",
      by: { did: OTHER_DID },
      indexedAt,
    };
  }

  if (replyParentAuthor !== null) {
    item.reply = {
      $type: "app.bsky.feed.defs#replyRef",
      root: { $type: "app.bsky.feed.defs#postView", author: { did: replyParentAuthor } },
      parent: { $type: "app.bsky.feed.defs#postView", author: { did: replyParentAuthor } },
    };
  }

  return item as unknown as FeedViewPost;
}

describe("filterFeedItems", () => {
  it("keeps originals and self-replies, drops reposts and replies to others", () => {
    const items: FeedViewPost[] = [
      makeFeedItem({ text: "original 1" }),
      makeFeedItem({ repost: true, text: "someone else's post" }),
      makeFeedItem({ replyParentAuthor: USER_DID, text: "self-reply (thread)" }),
      makeFeedItem({ replyParentAuthor: OTHER_DID, text: "reply to someone else" }),
      makeFeedItem({ text: "original 2" }),
    ];
    const result = filterFeedItems(items, USER_DID, Date.now());
    expect(result.map((p) => p.record.text)).toEqual([
      "original 1",
      "self-reply (thread)",
      "original 2",
    ]);
  });

  it("drops posts older than MAX_AGE_MS and keeps posts at the boundary", () => {
    const now = Date.now();
    const items: FeedViewPost[] = [
      makeFeedItem({
        text: "fresh",
        indexedAt: new Date(now - 1_000).toISOString(),
      }),
      makeFeedItem({
        text: "exactly at 90 days",
        indexedAt: new Date(now - MAX_AGE_MS).toISOString(),
      }),
      makeFeedItem({
        text: "one ms past 90 days",
        indexedAt: new Date(now - MAX_AGE_MS - 1).toISOString(),
      }),
      makeFeedItem({
        text: "ancient",
        indexedAt: new Date(now - MAX_AGE_MS * 10).toISOString(),
      }),
    ];
    const result = filterFeedItems(items, USER_DID, now);
    expect(result.map((p) => p.record.text)).toEqual([
      "fresh",
      "exactly at 90 days",
    ]);
  });
});

describe("meanPool", () => {
  it("returns the element-wise average of N equal-length vectors", () => {
    const result = meanPool([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(1 / 3, 10);
    expect(result[1]).toBeCloseTo(1 / 3, 10);
    expect(result[2]).toBeCloseTo(1 / 3, 10);
  });
});

describe("validateVoyageResponse", () => {
  function makeResponse(items: number): VoyageEmbedResponse {
    return {
      data: Array.from({ length: items }, (_, i) => ({
        embedding: new Array(1024).fill(0.1),
        index: i,
      })),
      model: "voyage-3.5-lite",
      usage: { total_tokens: 1000 },
    };
  }

  it("accepts a well-formed response", () => {
    expect(() => validateVoyageResponse(makeResponse(3), 3)).not.toThrow();
  });

  it("throws on malformed response shapes", () => {
    // Wrong length
    expect(() => validateVoyageResponse(makeResponse(2), 3)).toThrow(
      /length/i,
    );

    // Wrong dimension
    const wrongDim = makeResponse(1);
    wrongDim.data[0].embedding = new Array(512).fill(0.1);
    expect(() => validateVoyageResponse(wrongDim, 1)).toThrow(/dimension/i);

    // Non-finite value
    const nan = makeResponse(1);
    nan.data[0].embedding[0] = NaN;
    expect(() => validateVoyageResponse(nan, 1)).toThrow(/finite/i);

    // Missing data field
    const noData = { model: "voyage-3.5-lite", usage: { total_tokens: 0 } };
    expect(() =>
      validateVoyageResponse(noData as VoyageEmbedResponse, 1),
    ).toThrow(/data/i);
  });
});
