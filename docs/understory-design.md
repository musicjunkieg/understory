# Understory

**What your timeline missed.**

`understory.watch` — a social anti-algorithm for ATmosphereConf VODs. Your network already surfaced the popular talks. Understory finds the ones they didn't.

---

## The Concept

Every conference has the talk everyone posts about. Three mutuals live-tweeted it, two more quote-posted the slides, your timeline was saturated. You don't need an app to find that talk. You already found it.

Understory inverts the signal. It crawls your Bluesky social graph, measures how much attention each talk got from *your* network during and after the conference, and then sorts ascending. The talk nobody in your circle mentioned? That's your #1. The one only one person flagged? Probably #2.

But pure inversion is just noise. So Understory layers in interest matching — comparing your posting history and profile against talk transcripts via embeddings — to surface talks that are *relevant to you* but *invisible to your graph*. Your friends can also inject manual recommendations that override the algorithm entirely: social proof, but from humans, not engagement metrics.

The tagline: **"What your timeline missed."**

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        UNDERSTORY.WATCH                            │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐    │
│  │  Talk Pages   │   │  Score View  │   │  Coverage Map        │    │
│  │  /talk/:rkey  │   │  /for/:did   │   │  (visual heatmap)    │    │
│  │              │   │              │   │                      │    │
│  │  Video + ◄───┼───┤  Ranked list │   │  All talks as grid,  │    │
│  │  Transcript  │   │  w/ sliders  │   │  hot = covered,      │    │
│  │  + metadata  │   │  + friend    │   │  cold = understory   │    │
│  │              │   │  overrides   │   │                      │    │
│  └──────────────┘   └──────┬───────┘   └──────────────────────┘    │
│                            │                                        │
│  ┌─────────────────────────┴──────────────────────────────────┐    │
│  │                    SCORING ENGINE                           │    │
│  │                                                             │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐ │    │
│  │  │ Layer 1:     │  │ Layer 2:      │  │ Layer 3:          │ │    │
│  │  │ Network      │  │ Interest      │  │ Friend Overrides  │ │    │
│  │  │ Attention    │  │ Similarity    │  │                   │ │    │
│  │  │ (invert me)  │  │ (amplify/     │  │ watch.understory  │ │    │
│  │  │              │  │  balance)     │  │ .recommendation   │ │    │
│  │  │ Posts from   │  │              │  │ records from      │ │    │
│  │  │ follows in   │  │ User posts   │  │ follows' repos    │ │    │
│  │  │ conf window  │  │ vs. talk     │  │                   │ │    │
│  │  │              │  │ embeddings   │  │                   │ │    │
│  │  └─────────────┘  └──────────────┘  └───────────────────┘ │    │
│  │                                                             │    │
│  │  Sliders: ◄── Surprise Me ──────── For Me ──►              │    │
│  │           ◄── Algorithm ──────── Friends ──►               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                            │                                        │
│  ┌─────────────────────────┴──────────────────────────────────┐    │
│  │                    DATA LAYER                               │    │
│  │                                                             │    │
│  │  Existing records          Our records                      │    │
│  │  (read only)               (we publish)                     │    │
│  │  ┌──────────────────┐     ┌──────────────────────────────┐ │    │
│  │  │ place.stream     │     │ watch.understory              │ │    │
│  │  │   .video         │     │   .talkRef      (join)       │ │    │
│  │  │                  │     │   .transcript   (segments)   │ │    │
│  │  │ community        │     │   .topicIndex   (embeddings) │ │    │
│  │  │  .lexicon        │     │   .recommendation (social)   │ │    │
│  │  │  .calendar       │     │                              │ │    │
│  │  │  .event          │     │ User-owned:                  │ │    │
│  │  │                  │     │   .recommendation lives on   │ │    │
│  │  │ app.bsky         │     │   each user's own PDS        │ │    │
│  │  │   .feed.post     │     │                              │ │    │
│  │  │   .actor.profile │     │                              │ │    │
│  │  └──────────────────┘     └──────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Lexicon Schemas

All lexicons live under the `watch.understory` NSID authority (reversed from `understory.watch`).

### `watch.understory.talkRef` — The Join Record

Bridges `place.stream.video` (the VOD) to `community.lexicon.calendar.event` (the schedule entry). This is the canonical "talk" object our app indexes against. Without it, we're stuck fuzzy-matching titles.

```json
{
  "lexicon": 1,
  "id": "watch.understory.talkRef",
  "description": "Links a Streamplace VOD to its ATmosphereConf event record with resolved speaker identities and topic tags.",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["video", "event", "createdAt"],
        "properties": {
          "video": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Strong reference to the place.stream.video record"
          },
          "event": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Strong reference to the community.lexicon.calendar.event record"
          },
          "speakers": {
            "type": "array",
            "maxLength": 10,
            "items": {
              "type": "string",
              "format": "did"
            },
            "description": "Speaker DIDs resolved from event data and handle resolution"
          },
          "talkType": {
            "type": "string",
            "knownValues": [
              "watch.understory.talkRef#presentation",
              "watch.understory.talkRef#lightning",
              "watch.understory.talkRef#panel",
              "watch.understory.talkRef#workshop",
              "watch.understory.talkRef#keynote"
            ],
            "description": "Classification of the talk format"
          },
          "room": {
            "type": "string",
            "maxLength": 128,
            "description": "Room or stream identifier"
          },
          "tags": {
            "type": "array",
            "maxLength": 10,
            "items": {
              "type": "string",
              "maxLength": 64
            },
            "description": "Topic tags derived from event description, title, and transcript analysis"
          },
          "createdAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    }
  }
}
```

### `watch.understory.transcript` — Timestamped Transcript

Full transcript with speaker-attributed, time-synced segments. Each segment maps to a scrollable, clickable line in the talk page UI.

```json
{
  "lexicon": 1,
  "id": "watch.understory.transcript",
  "description": "Timestamped, speaker-attributed transcript of an ATmosphereConf talk. Segments sync to the VOD timeline for interactive playback.",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["talkRef", "segments", "createdAt"],
        "properties": {
          "talkRef": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Reference to the watch.understory.talkRef this transcribes"
          },
          "lang": {
            "type": "string",
            "format": "language",
            "description": "BCP-47 language tag of the transcript (e.g. 'en')"
          },
          "model": {
            "type": "string",
            "maxLength": 128,
            "description": "Transcription model used (e.g. 'whisper-large-v3')"
          },
          "segments": {
            "type": "array",
            "items": {
              "type": "ref",
              "ref": "#segment"
            }
          },
          "createdAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    },
    "segment": {
      "type": "object",
      "required": ["startMs", "endMs", "text"],
      "properties": {
        "startMs": {
          "type": "integer",
          "description": "Segment start time in milliseconds from video start"
        },
        "endMs": {
          "type": "integer",
          "description": "Segment end time in milliseconds from video start"
        },
        "text": {
          "type": "string",
          "maxLength": 10000,
          "description": "Transcript text for this segment"
        },
        "speaker": {
          "type": "string",
          "format": "did",
          "description": "DID of the speaker for this segment, if identified via diarization"
        },
        "confidence": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100,
          "description": "Transcription confidence score (0-100)"
        }
      }
    }
  }
}
```

### `watch.understory.topicIndex` — Embeddings & Topics

Our computed semantic index. The embedding enables cosine similarity matching between a user's interest profile and talk content. Topics provide human-readable labels.

```json
{
  "lexicon": 1,
  "id": "watch.understory.topicIndex",
  "description": "Computed topic analysis and dense embedding for a talk, derived from its transcript. Powers interest-based matching in the scoring engine.",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["talkRef", "topics", "createdAt"],
        "properties": {
          "talkRef": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef"
          },
          "topics": {
            "type": "array",
            "maxLength": 20,
            "items": {
              "type": "ref",
              "ref": "#topic"
            },
            "description": "Extracted topic labels with relevance weights"
          },
          "embedding": {
            "type": "bytes",
            "maxLength": 8192,
            "description": "Dense vector embedding of the full transcript, packed as float32 array"
          },
          "embeddingModel": {
            "type": "string",
            "maxLength": 128,
            "description": "Model used for embedding generation"
          },
          "createdAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    },
    "topic": {
      "type": "object",
      "required": ["label", "weight"],
      "properties": {
        "label": {
          "type": "string",
          "maxLength": 128,
          "description": "Human-readable topic label (e.g. 'decentralized identity', 'content moderation', 'Rust')"
        },
        "weight": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1000,
          "description": "Relevance weight 0-1000 (integer to avoid CBOR float issues)"
        }
      }
    }
  }
}
```

### `watch.understory.recommendation` — Friend Recommendations

This is the social override layer. It lives on *each user's own PDS* — your friends publish these, and you pull them from your follows' repos via `listRecords`. The social graph becomes the recommender.

```json
{
  "lexicon": 1,
  "id": "watch.understory.recommendation",
  "description": "A personal recommendation for an ATmosphereConf talk, published to the recommender's own PDS. Pulled by Understory from your follows' repos to inject social signal into your feed.",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["video", "createdAt"],
        "properties": {
          "video": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Strong reference to the place.stream.video record being recommended"
          },
          "note": {
            "type": "string",
            "maxLength": 500,
            "description": "Why you're recommending this talk — shows up as a pull quote in the recipient's feed"
          },
          "intensity": {
            "type": "integer",
            "minimum": 1,
            "maximum": 3,
            "description": "1 = worth watching, 2 = really good, 3 = changed my thinking"
          },
          "tags": {
            "type": "array",
            "maxLength": 5,
            "items": {
              "type": "string",
              "maxLength": 64
            },
            "description": "Freeform topic tags — builds a folksonomy of what the community thinks talks are actually about"
          },
          "createdAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    }
  }
}
```

---

## The Scoring Algorithm

### Inputs

For a given user (identified by their DID after OAuth):

1. **Their follows list** — `app.bsky.graph.getFollows`
2. **Each follow's posts during the conference window** — March 26–April 5, 2026 (conference + 1 week aftermath). Bounded `getAuthorFeed` or `searchPosts` calls.
3. **The user's own recent posts** — last 30 days, for interest profiling.
4. **Friend recommendation records** — `listRecords` on each follow's repo for `watch.understory.recommendation`.
5. **Our precomputed topic indices** — embeddings and topic labels for all talks.

### Scoring per talk

```
For each talk T:

  # Layer 1: Network Attention (inverted)
  network_score = 0
  for each follow F:
    if F posted about T (URI match, title keyword, speaker mention):
      network_score += 1
      if F engaged heavily (multiple posts, quote posts):
        network_score += 1
  
  # Invert: high attention → low score
  attention_inverse = max_network_score - network_score
  
  # Layer 2: Interest Similarity
  user_embedding = embed(user's recent posts)
  talk_embedding = topicIndex[T].embedding
  interest_score = cosine_similarity(user_embedding, talk_embedding)
  
  # Layer 3: Friend Overrides
  friend_boost = 0
  friend_recs = []
  for each follow F:
    if F has a recommendation for T:
      friend_boost += rec.intensity  # 1-3
      friend_recs.append(rec)
  
  # Combine with slider weights
  # surprise_slider: 0.0 (max interest matching) to 1.0 (max randomness)
  # friends_slider: 0.0 (algorithm only) to 1.0 (friends dominate)
  
  effective_interest = interest_score * (1.0 - surprise_slider)
  
  final_score = (
    (attention_inverse * 0.5) +
    (effective_interest * 0.3) +
    (friend_boost * friends_slider * 0.2)
  )
```

### Detection: How we match posts to talks

A post "mentions" a talk if any of:
- It contains an `at://` URI pointing to the talk's `place.stream.video` or `community.lexicon.calendar.event` record
- It embeds/quotes the video or event record
- It mentions the speaker's handle AND uses a conference-related term (#ATmosphereConf, "atmosphereconf", etc.)
- Its text contains a significant substring match against the talk title (fuzzy, threshold TBD)

This is bounded and tractable because:
- We know the exact conference window (March 26–29 + aftermath)
- We have a finite list of ~50 unique talks with known titles and speaker handles
- We're only crawling the user's follows, not the entire network

### Slider Behavior

Two sliders in the UI control the weighting:

**"Surprise Me ←→ For Me"**
- Full left: interest matching is zeroed out. You get pure inversion — the talks your network missed, regardless of your interests. Maximum serendipity.
- Full right: interest matching dominates. You get talks that match your profile but your network missed. Targeted discovery.

**"Algorithm ←→ Friends"**
- Full left: friend recommendations don't affect ranking. Pure computed score.
- Full right: friend recommendations dominate. If 3 friends said "watch this," it's at the top regardless of network attention or interest matching.

---

## Transcription Pipeline

### Step 1: Audio Extraction

```
For each place.stream.video record:
  1. GET the HLS playlist:
     https://vod-beta.stream.place/xrpc/place.stream.playback.getVideoPlaylist?uri={at_uri}
  2. Download the HLS segments
  3. ffmpeg -i playlist.m3u8 -vn -acodec pcm_s16le -ar 16000 -ac 1 talk.wav
```

Some VODs are full-room streams (8+ hours). For these, we use the `start`/`end` fields on `place.stream.video.source` (present on some records like "Data Sovereignty for Games") to extract just the talk portion. For records without start/end, we use the individual talk VODs.

### Step 2: Transcription

- **Model**: Whisper large-v3 (or large-v3-turbo for speed)
- **Output**: Word-level timestamps, language detection
- **Runtime**: Local on Bryan's M4 Pro Mac mini (64GB) via MLX, or Cloudflare Workers AI for production
- Estimated: ~50 talks × average 25 minutes = ~20 hours of audio. Whisper large-v3 processes at ~10x realtime on M4 Pro, so ~2 hours total processing.

### Step 3: Speaker Diarization (optional, high value)

- Use pyannote/speaker-diarization-3.1 to segment by speaker
- Match speaker segments against known speaker DIDs from the `community.lexicon.calendar.event` records
- For single-speaker presentations: trivial — assign the speaker DID to all segments
- For panels/discussions: diarize first, then match by comparing segment clusters to known speaker count

### Step 4: Topic Extraction & Embedding

For each talk transcript:
1. Run full transcript through an embedding model (e.g. `all-MiniLM-L6-v2` or similar) → dense vector
2. Extract topic keywords via TF-IDF or LLM-based extraction → human-readable labels with weights
3. Pack embedding as `bytes` (float32 array → raw bytes) for the `topicIndex` record

### Step 5: Record Publication

Publish `watch.understory.talkRef`, `watch.understory.transcript`, and `watch.understory.topicIndex` records to the Understory app's repo (a dedicated DID/PDS for the app).

---

## Talk Pages

### URL Structure

```
understory.watch/                          → Landing + OAuth login
understory.watch/for/:handle              → Your personalized feed
understory.watch/talk/:rkey               → Individual talk page
understory.watch/map/:handle              → Your coverage map
```

---

## Tech Stack

### Frontend
- **Framework**: React (Next.js or Astro with React islands)
- **Video**: HLS.js for adaptive streaming
- **Styling**: Tailwind CSS with custom theme tokens
- **Animation**: CSS transitions + Framer Motion for the coverage map
- **Hosting**: Vercel or Cloudflare Pages

### Backend / Data Pipeline
- **Transcription**: Whisper large-v3 via MLX on M4 Pro Mac mini (batch processing)
- **Diarization**: pyannote/speaker-diarization-3.1
- **Embeddings**: all-MiniLM-L6-v2 or similar (can run locally)
- **Topic extraction**: LLM-based (Claude API or local model)
- **Social graph crawl**: Bluesky API (`getFollows`, `getAuthorFeed`, `searchPosts`)
- **AT Protocol writes**: `@atproto/api` for publishing records to Understory's PDS

### Infrastructure
- **App PDS**: Understory needs its own DID and PDS for publishing talkRef, transcript, and topicIndex records
- **OAuth**: AT Protocol OAuth for user authentication (get their DID, permission to read their follows)
- **Scoring**: Can be computed client-side for the jam (follows list is public, posts are public, our index is public). No server needed for the core experience.

### Key Insight: Client-Side Scoring

For the jam, the scoring engine can run entirely in the browser:
1. User authenticates via AT Protocol OAuth → we get their DID
2. Fetch their follows list (public API)
3. For each follow, fetch posts in the conference window (public API)
4. Match posts to talks (our precomputed talk list)
5. Fetch friend recommendation records from follows' repos (public API)
6. Compute scores, render the coverage map

No backend scoring server needed. The data pipeline (transcription, embedding) runs offline as a batch job. The scoring happens at request time in the client.

---

## Implementation Plan

### Phase 1: Foundation (Days 1-3)
- [ ] Set up `understory.watch` domain and project repo (Tangled)
- [ ] Create Understory DID + PDS for record publishing
- [ ] Build the talkRef join records: match all ~50 talks from `community.lexicon.calendar.event` to their `place.stream.video` VODs
- [ ] Set up HLS.js video player component
- [ ] Basic talk page layout with video + metadata

### Phase 2: Transcription (Days 3-6)
- [ ] Audio extraction pipeline (HLS → WAV via ffmpeg)
- [ ] Whisper transcription (batch run on Mac mini)
- [ ] Speaker diarization for multi-speaker talks
- [ ] Publish `watch.understory.transcript` records
- [ ] Build transcript UI component with click-to-seek
- [ ] Full text search across all transcripts

### Phase 3: Scoring Engine (Days 6-9)
- [ ] AT Protocol OAuth flow
- [ ] Social graph crawler (follows + their posts in conference window)
- [ ] Post-to-talk matching logic
- [ ] Friend recommendation record reading
- [ ] Scoring algorithm implementation
- [ ] Slider UI for weight controls

### Phase 4: Embeddings & Interest Matching (Days 7-10)
- [ ] Generate embeddings from transcripts
- [ ] Publish `watch.understory.topicIndex` records
- [ ] User interest profiling from their recent posts
- [ ] Cosine similarity matching
- [ ] Interest layer integration into scoring engine

### Phase 5: Coverage Map & Polish (Days 10-12)
- [ ] Coverage map visualization (the grid)
- [ ] Bioluminescent glow design system
- [ ] Animation and transitions
- [ ] Mobile responsiveness
- [ ] Friend recommendation UI (publish + display)
- [ ] Landing page

### Phase 6: Ship (Days 12-14)
- [ ] Deploy to production
- [ ] Ensure all VODs are accessible
- [ ] Write submission post
- [ ] Open source with MIT license on Tangled
- [ ] Submit to @stream.place VOD JAM announcement post

---

## Open Questions

1. **Record size limits**: Transcripts for long talks (45+ minutes) may exceed ATProto record size limits. May need to split into multiple transcript records per talk, referenced by a parent record. Need to check the limit (currently ~1MB per record).

2. **Full-room streams vs. individual talk VODs**: Some talks only exist as segments of 8-hour room streams. The `start`/`end` fields on some `place.stream.video.source` objects handle this, but not all records have them. May need to manually create timestamps for some talks.

3. **Rate limiting on social graph crawl**: If a user follows 2,000 people, that's 2,000 `getAuthorFeed` calls. Need to paginate intelligently and potentially cache results. Could limit the crawl to the first N follows, or use a server-side cache.

4. **Friend recommendation adoption**: The `watch.understory.recommendation` lexicon only works if people actually publish records. Need a dead-simple "recommend this" button in the UI that does an OAuth-authenticated `createRecord` to the user's PDS.

5. **Namespace**: Using `watch.understory` (reversed from `understory.watch`). Need to set up lexicon resolution via DNS TXT records or the new lexicon resolution spec.
