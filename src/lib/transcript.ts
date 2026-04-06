import type { Utterance, TranscriptSegment } from "./types";

/**
 * Strip trailing punctuation for word comparison.
 */
function normalize(s: string): string {
  return s
    .replace(/[.,!?;:'")\]]+$/, "")
    .replace(/^['"(\[]+/, "")
    .toLowerCase();
}

/**
 * Split utterances into sentence-level segments with interpolated timestamps.
 * Walks the words array sequentially, matching tokens to derive accurate timing.
 */
export function splitUtterances(
  utterances: Utterance[],
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  if (!utterances || utterances.length === 0) return segments;

  for (let uIdx = 0; uIdx < utterances.length; uIdx++) {
    const utterance = utterances[uIdx];
    const sentences = utterance.text.split(/(?<=[.!?])\s+/).filter(Boolean);

    if (sentences.length === 0) continue;

    // If only one sentence or no words, treat entire utterance as one segment
    if (
      sentences.length === 1 ||
      !utterance.words ||
      utterance.words.length === 0
    ) {
      segments.push({
        id: `u${uIdx}-s0`,
        speaker: utterance.speaker,
        text: utterance.text,
        startMs: utterance.start,
        endMs: utterance.end,
      });
      continue;
    }

    let wordPtr = 0;
    const words = utterance.words;

    for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
      const sentence = sentences[sIdx];
      const tokens = sentence.split(/\s+/).filter(Boolean);

      // Try to match tokens to words sequentially
      const startWord = wordPtr;

      for (const token of tokens) {
        if (wordPtr >= words.length) break;
        const normalizedToken = normalize(token);
        const normalizedWord = normalize(words[wordPtr].text);

        if (
          normalizedToken === normalizedWord ||
          normalizedWord.startsWith(normalizedToken) ||
          normalizedToken.startsWith(normalizedWord)
        ) {
          wordPtr++;
        } else {
          // Skip ahead up to 2 words to handle minor mismatches
          let found = false;
          for (
            let skip = 1;
            skip <= 2 && wordPtr + skip < words.length;
            skip++
          ) {
            if (normalize(words[wordPtr + skip].text) === normalizedToken) {
              wordPtr += skip + 1;
              found = true;
              break;
            }
          }
          if (!found) {
            wordPtr++;
          }
        }
      }

      // Derive timestamps from matched words
      let startMs: number;
      let endMs: number;

      if (startWord < words.length && wordPtr > startWord) {
        startMs = words[startWord].start;
        endMs = words[Math.min(wordPtr - 1, words.length - 1)].end;
      } else {
        // Fallback: interpolate proportionally
        const charStart = sentences.slice(0, sIdx).join(" ").length;
        const charEnd = charStart + sentence.length;
        const totalChars = utterance.text.length;
        const duration = utterance.end - utterance.start;
        startMs = utterance.start + (charStart / totalChars) * duration;
        endMs = utterance.start + (charEnd / totalChars) * duration;
      }

      segments.push({
        id: `u${uIdx}-s${sIdx}`,
        speaker: utterance.speaker,
        text: sentence,
        startMs: Math.round(startMs),
        endMs: Math.round(endMs),
      });
    }
  }

  return segments;
}
