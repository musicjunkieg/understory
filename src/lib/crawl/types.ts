export interface TalkMention {
  count: number;
  follows: string[];
  posts: string[];
  rsvps: string[];
}

export interface TalkMentions {
  [rkey: string]: TalkMention;
}

export interface CrawlResult {
  talkMentions: TalkMentions;
  followCount: number;
  postsScanned: number;
  crawledAt: number;
  /** User interest profile vector (1024-dim voyage-3.5-lite query
   *  embedding, mean-pooled across recent original posts). Null when
   *  the profile build failed or the user had no usable posts. See
   *  interestProfileStatus for the reason. */
  interestVector: number[] | null;
  /** Diagnostic state for the profile build. "ok" when a vector was
   *  produced, "no-posts" when the user had zero usable posts after
   *  filtering, "error" when Voyage or the feed fetch failed. */
  interestProfileStatus: "ok" | "no-posts" | "error";
}

export interface CacheEntry {
  data: CrawlResult;
  timestamp: number;
}
