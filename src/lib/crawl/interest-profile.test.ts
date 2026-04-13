import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AppBskyFeedDefs } from "@atproto/api";
import {
  buildInterestVector,
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

  it("drops posts with empty, whitespace-only, missing, or non-string record.text", () => {
    // Build bare feed items with malformed records that makeFeedItem
    // can't naturally produce. Only the filter-relevant fields are set.
    const now = new Date().toISOString();
    const makeBareItem = (record: unknown): FeedViewPost => ({
      post: {
        $type: "app.bsky.feed.defs#postView",
        uri: `at://${USER_DID}/app.bsky.feed.post/${Math.random()}`,
        cid: "bafytest",
        author: { did: USER_DID, handle: "test.bsky.social" },
        record,
        indexedAt: now,
      },
    } as unknown as FeedViewPost);

    const items: FeedViewPost[] = [
      // A real post to prove the filter is running (should survive).
      makeFeedItem({ text: "real content" }),
      // Record with empty-string text.
      makeBareItem({ $type: "app.bsky.feed.post", text: "", createdAt: now }),
      // Record with whitespace-only text.
      makeBareItem({ $type: "app.bsky.feed.post", text: "   \n\t  ", createdAt: now }),
      // Record with undefined text field.
      makeBareItem({ $type: "app.bsky.feed.post", createdAt: now }),
      // Record with non-string text (numeric).
      makeBareItem({ $type: "app.bsky.feed.post", text: 42, createdAt: now }),
      // Missing record object entirely.
      makeBareItem(undefined),
    ];
    const result = filterFeedItems(items, USER_DID, Date.now());
    expect(result.map((p) => p.record.text)).toEqual(["real content"]);
  });

  it("drops posts with a non-parseable indexedAt timestamp", () => {
    const now = Date.now();
    // Build a feed item with a garbage indexedAt. makeFeedItem's default
    // path always stamps a valid ISO string, so we assemble the item by hand.
    const makeItemWithBadDate = (
      text: string,
      indexedAt: string,
    ): FeedViewPost => ({
      post: {
        $type: "app.bsky.feed.defs#postView",
        uri: `at://${USER_DID}/app.bsky.feed.post/${Math.random()}`,
        cid: "bafytest",
        author: { did: USER_DID, handle: "test.bsky.social" },
        record: { $type: "app.bsky.feed.post", text, createdAt: indexedAt },
        indexedAt,
      },
    } as unknown as FeedViewPost);

    const items: FeedViewPost[] = [
      makeFeedItem({ text: "good post" }),
      makeItemWithBadDate("garbage date", "not-a-date"),
      makeItemWithBadDate("empty date", ""),
      makeItemWithBadDate("nonsense", "tomorrow"),
    ];
    const result = filterFeedItems(items, USER_DID, now);
    expect(result.map((p) => p.record.text)).toEqual(["good post"]);
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

describe("buildInterestVector", () => {
  // Minimal mock Agent surface: only getAuthorFeed is consulted.
  // Returns a queue of pages the test can preload.
  function makeAgent(pages: Array<{ feed: unknown[]; cursor?: string }>) {
    let page = 0;
    return {
      getAuthorFeed: async () => ({
        data: pages[Math.min(page++, pages.length - 1)] ?? { feed: [] },
      }),
    } as unknown as Parameters<typeof buildInterestVector>[0];
  }

  function makeVoyageOk(n: number): VoyageEmbedResponse {
    return {
      data: Array.from({ length: n }, (_, i) => ({
        embedding: new Array(1024).fill(1), // each post is the vector [1,1,...]
        index: i,
      })),
      model: "voyage-3.5-lite",
      usage: { total_tokens: 100 },
    };
  }

  beforeEach(() => {
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns no-posts status without hitting Voyage when feed is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const agent = makeAgent([{ feed: [] }]);

    const result = await buildInterestVector(agent, "did:plc:self");

    expect(result.status).toBe("no-posts");
    expect(result.vector).toBeNull();
    expect(result.postCount).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("batch-embeds filtered posts and returns the mean-pooled vector", async () => {
    const now = new Date().toISOString();
    const feedPage = {
      feed: [
        { post: { uri: "at://a", cid: "c", author: { did: "did:plc:self" }, record: { text: "post one", createdAt: now }, indexedAt: now } },
        { post: { uri: "at://b", cid: "c", author: { did: "did:plc:self" }, record: { text: "post two", createdAt: now }, indexedAt: now } },
      ],
    };
    const agent = makeAgent([feedPage]);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(makeVoyageOk(2)), { status: 200 }),
      );

    const result = await buildInterestVector(agent, "did:plc:self");

    expect(result.status).toBe("ok");
    expect(result.postCount).toBe(2);
    expect(result.vector).not.toBeNull();
    expect(result.vector!.length).toBe(1024);
    // Both input vectors were [1,1,...,1], so mean is also [1,1,...,1].
    expect(result.vector![0]).toBeCloseTo(1, 10);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("voyage-3.5-lite");
    expect(body.input_type).toBe("query");
    expect(body.input).toEqual(["post one", "post two"]);
  });

  it("returns error status on Voyage failure without throwing", async () => {
    const now = new Date().toISOString();
    const agent = makeAgent([
      {
        feed: [
          { post: { uri: "at://a", cid: "c", author: { did: "did:plc:self" }, record: { text: "post one", createdAt: now }, indexedAt: now } },
        ],
      },
    ]);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream 500", { status: 500 }),
    );

    const result = await buildInterestVector(agent, "did:plc:self");

    expect(result.status).toBe("error");
    expect(result.vector).toBeNull();
    // postCount reflects the count we attempted to embed — useful for logs.
    expect(result.postCount).toBe(1);
  });
});
