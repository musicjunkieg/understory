import type { TalkEntry } from "@/lib/types";

export interface FriendStubResult {
  friendBoost: number;
  recommenders: string[];
}

/**
 * Layer 3 stub. Returns 0 until the following issues land:
 *   - #18: friend recommendation reader
 *   - #5:  publish lexicons
 *
 * When implemented, this should return the normalized sum of friend
 * recommendation intensities (1–3 each, capped at a sensible max) and the
 * DIDs of the recommending follows.
 */
export function computeFriendStub(talk: TalkEntry): FriendStubResult {
  void talk;
  return { friendBoost: 0, recommenders: [] };
}
