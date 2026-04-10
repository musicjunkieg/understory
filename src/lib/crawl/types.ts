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
}

export interface CacheEntry {
  data: CrawlResult;
  timestamp: number;
}
