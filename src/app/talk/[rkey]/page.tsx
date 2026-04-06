import { notFound } from "next/navigation";
import * as fs from "fs";
import * as path from "path";
import { Nav } from "@/components/ui/nav";
import { Chip } from "@/components/ui/chip";
import { TalkPageClient } from "@/components/talk-page-client";
import { splitUtterances } from "@/lib/transcript";
import { formatDuration, formatDate } from "@/lib/format";
import type { TalkEntry, TranscriptData } from "@/lib/types";

const DATA_DIR = path.resolve(process.cwd(), "data");

function loadTalks(): TalkEntry[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, "talks.json"), "utf-8");
  return JSON.parse(raw);
}

function loadTranscript(transcriptFile: string): TranscriptData {
  const raw = fs.readFileSync(path.join(DATA_DIR, transcriptFile), "utf-8");
  return JSON.parse(raw);
}

export async function generateStaticParams() {
  const talks = loadTalks();
  return talks
    .filter((t) => t.transcriptFile)
    .map((t) => ({ rkey: t.rkey }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ rkey: string }>;
}) {
  const { rkey } = await params;
  const talks = loadTalks();
  const talk = talks.find((t) => t.rkey === rkey);
  if (!talk) return { title: "Talk not found" };
  return {
    title: `${talk.title} — Understory`,
    description:
      talk.description ??
      `Watch ${talk.title} from ATmosphereConf 2026`,
  };
}

export default async function TalkPage({
  params,
}: {
  params: Promise<{ rkey: string }>;
}) {
  const { rkey } = await params;
  const talks = loadTalks();
  const talk = talks.find((t) => t.rkey === rkey);

  if (!talk) notFound();

  // Load and split transcript
  let segments: ReturnType<typeof splitUtterances> = [];
  if (talk.transcriptFile) {
    const transcript = loadTranscript(talk.transcriptFile);
    segments = splitUtterances(transcript.transcription.utterances);
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-6 pt-24 pb-16">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-headline-md text-on-surface mb-3">
            {talk.title}
          </h1>

          {/* Speakers */}
          {talk.speakers.length > 0 && (
            <p className="text-label-md text-on-surface-variant mb-3">
              {talk.speakers
                .map((s) => `${s.name} @${s.id}`)
                .join(" · ")}
            </p>
          )}

          {/* Metadata chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {talk.room && <Chip>{talk.room}</Chip>}
            {talk.talkType && <Chip>{talk.talkType}</Chip>}
            <Chip>{formatDuration(talk.durationMs)}</Chip>
            {talk.startsAt && <Chip>{formatDate(talk.startsAt)}</Chip>}
          </div>

          {/* Description */}
          {talk.description && (
            <p className="text-body-md text-on-surface-variant max-w-3xl">
              {talk.description}
            </p>
          )}
        </header>

        {/* Video + Transcript */}
        {segments.length > 0 ? (
          <TalkPageClient
            hlsUrl={talk.hlsUrl}
            segments={segments}
            speakers={talk.speakers}
          />
        ) : (
          <div className="rounded-lg overflow-hidden bg-surface-container-lowest">
            <video
              controls
              className="w-full aspect-video"
              src={talk.hlsUrl}
              playsInline
            >
              Your browser does not support video playback.
            </video>
          </div>
        )}
      </main>
    </>
  );
}
