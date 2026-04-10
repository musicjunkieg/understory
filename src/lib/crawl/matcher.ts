import type { TalkEntry } from "@/lib/types";
import type { AppBskyFeedDefs } from "@atproto/api";

type PostView = AppBskyFeedDefs.PostView;

const CONF_TERMS = ["atmosphereconf", "atmosphere conf", "atmoconf", "stream.place"];

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "shall", "this", "that",
  "these", "those", "it", "its",
]);

function getSignificantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function hasConfTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return CONF_TERMS.some((term) => lower.includes(term));
}

function getPostText(post: PostView): string {
  const record = post.record as { text?: string };
  return record?.text ?? "";
}

function collectRecordUris(
  container: Record<string, unknown> | undefined,
  uris: string[],
): void {
  if (!container) return;

  // Plain record embed: { record: { uri } }
  // (app.bsky.embed.record / #view)
  if (container.record && typeof container.record === "object") {
    const rec = container.record as { uri?: string; record?: unknown };
    if (typeof rec.uri === "string") {
      uris.push(rec.uri);
    }
    // recordWithMedia nests one level deeper:
    // { record: { record: { uri } } }  (app.bsky.embed.recordWithMedia / #view)
    if (rec.record && typeof rec.record === "object") {
      const inner = rec.record as { uri?: string };
      if (typeof inner.uri === "string") {
        uris.push(inner.uri);
      }
    }
  }

  // External embed: { external: { uri } }
  if (container.external && typeof container.external === "object") {
    const ext = container.external as { uri?: string };
    if (typeof ext.uri === "string") {
      uris.push(ext.uri);
    }
  }
}

function getEmbedUris(post: PostView): string[] {
  const uris: string[] = [];
  const record = post.record as { embed?: Record<string, unknown> };
  const embed = post.embed as Record<string, unknown> | undefined;

  // View-level embed (hydrated shape returned by feed/search endpoints)
  collectRecordUris(embed, uris);

  // Record-level embed (raw embed inside the post record itself)
  collectRecordUris(record?.embed, uris);

  return uris;
}

/**
 * Match a single post against all talks. Returns rkeys of matched talks.
 */
export function matchPost(
  post: PostView,
  talks: TalkEntry[],
): string[] {
  const text = getPostText(post);
  const textLower = text.toLowerCase();
  const embedUris = getEmbedUris(post);
  const matched: string[] = [];

  for (const talk of talks) {
    // 1. URI match in text
    if (talk.vodUri && textLower.includes(talk.vodUri.toLowerCase())) {
      matched.push(talk.rkey);
      continue;
    }
    if (talk.eventUri && textLower.includes(talk.eventUri.toLowerCase())) {
      matched.push(talk.rkey);
      continue;
    }

    // 2. Embed match
    if (embedUris.some((uri) => uri === talk.vodUri || uri === talk.eventUri)) {
      matched.push(talk.rkey);
      continue;
    }

    // 3. Speaker + conference term
    if (hasConfTerm(textLower) && talk.speakers.length > 0) {
      const mentionsSpeaker = talk.speakers.some((s) => {
        const handle = s.id.toLowerCase();
        return textLower.includes(handle) || textLower.includes(`@${handle}`);
      });
      if (mentionsSpeaker) {
        matched.push(talk.rkey);
        continue;
      }
    }

    // 4. Title match (≥4 significant words) + conference term
    if (hasConfTerm(textLower)) {
      const titleWords = getSignificantWords(talk.title);
      if (titleWords.length >= 4) {
        const postWords = getSignificantWords(text);
        const postWordStr = postWords.join(" ");
        // Check for 4+ consecutive title words in post
        for (let i = 0; i <= titleWords.length - 4; i++) {
          const seq = titleWords.slice(i, i + 4).join(" ");
          if (postWordStr.includes(seq)) {
            matched.push(talk.rkey);
            break;
          }
        }
      }
    }
  }

  return matched;
}
