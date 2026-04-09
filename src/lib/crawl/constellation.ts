import type { TalkEntry } from "@/lib/types";

const CONSTELLATION_BASE = "https://constellation.microcosm.blue";

interface ConstellationLinksAll {
  links: Record<string, Record<string, { records: number; distinct_dids: number }>>;
}

interface ConstellationBacklink {
  did: string;
  collection: string;
  rkey: string;
  path: string;
}

interface ConstellationBacklinksResponse {
  total: number;
  records: ConstellationBacklink[];
  cursor: string | null;
}

/**
 * For each talk with an eventUri, query Constellation for RSVPs.
 * Returns a map of rkey → Set of DIDs who RSVPed.
 */
export async function fetchRsvps(
  talks: TalkEntry[],
): Promise<Map<string, Set<string>>> {
  const rsvpMap = new Map<string, Set<string>>();
  const talksWithEvents = talks.filter((t) => t.eventUri);

  // First pass: check which talks have RSVPs (parallelized)
  const linksResults = await Promise.allSettled(
    talksWithEvents.map(async (talk) => {
      const url = `${CONSTELLATION_BASE}/links/all?target=${encodeURIComponent(talk.eventUri!)}`;
      const res = await fetch(url);
      if (!res.ok) return { talk, hasRsvps: false };
      const data: ConstellationLinksAll = await res.json();
      const rsvpEntry = data.links?.["community.lexicon.calendar.rsvp"];
      const hasRsvps = rsvpEntry && Object.values(rsvpEntry).some((v) => v.records > 0);
      return { talk, hasRsvps: !!hasRsvps };
    }),
  );

  // Second pass: fetch actual RSVP DIDs for talks that have them
  const talksWithRsvps = linksResults
    .filter((r): r is PromiseFulfilledResult<{ talk: TalkEntry; hasRsvps: boolean }> =>
      r.status === "fulfilled" && r.value.hasRsvps,
    )
    .map((r) => r.value.talk);

  await Promise.allSettled(
    talksWithRsvps.map(async (talk) => {
      const dids = new Set<string>();
      let cursor: string | null = null;

      do {
        const params = new URLSearchParams({
          subject: talk.eventUri!,
          source: "community.lexicon.calendar.rsvp:.subject.uri",
          limit: "100",
        });
        if (cursor) params.set("cursor", cursor);

        const url = `${CONSTELLATION_BASE}/xrpc/blue.microcosm.links.getBacklinks?${params}`;
        const res = await fetch(url);
        if (!res.ok) break;

        const data: ConstellationBacklinksResponse = await res.json();
        for (const record of data.records) {
          dids.add(record.did);
        }
        cursor = data.cursor;
      } while (cursor);

      if (dids.size > 0) {
        rsvpMap.set(talk.rkey, dids);
      }
    }),
  );

  return rsvpMap;
}
