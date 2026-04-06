// Talk entry from data/talks.json
export interface Speaker {
  id: string;
  name: string;
}

export interface TalkEntry {
  rkey: string;
  title: string;
  vodUri: string;
  vodCid: string;
  hlsUrl: string;
  durationMs: number;
  createdAt: string;
  eventUri: string | null;
  description: string | null;
  speakers: Speaker[];
  room: string | null;
  talkType: string | null;
  category: string | null;
  startsAt: string | null;
  endsAt: string | null;
  transcriptFile: string | null;
}

// From data/transcripts/[rkey].json
export interface Word {
  text: string;
  start: number;
  end: number;
  speaker: string;
  confidence?: number;
}

export interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  words: Word[];
  confidence?: number;
}

export interface TranscriptData {
  uri: string;
  cid: string;
  title: string;
  creator: string;
  duration: number;
  createdAt: string;
  transcription: {
    id: string;
    status: string;
    text: string;
    utterances: Utterance[];
    words: Word[];
    audio_duration: number;
  };
}

// Processed segment for the transcript UI
export interface TranscriptSegment {
  id: string;
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
}

// Seek state with counter for re-triggering
export interface SeekTarget {
  timeMs: number;
  id: number;
}
