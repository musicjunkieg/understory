import * as fs from "fs";
import * as path from "path";
import Link from "next/link";
import { Nav } from "@/components/ui/nav";
import { Chip } from "@/components/ui/chip";
import { LumeCard } from "@/components/ui/lume-card";
import { formatDuration } from "@/lib/format";
import type { TalkEntry } from "@/lib/types";

const DATA_DIR = path.resolve(process.cwd(), "data");

function loadTalks(): TalkEntry[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, "talks.json"), "utf-8");
  return JSON.parse(raw);
}

export const metadata = {
  title: "All Talks — Understory",
  description: "Browse all ATmosphereConf 2026 talks with transcripts.",
};

export default function TalksPage() {
  const talks = loadTalks()
    .filter((t) => t.transcriptFile)
    .sort((a, b) => {
      if (a.startsAt && b.startsAt)
        return a.startsAt.localeCompare(b.startsAt);
      if (a.startsAt) return -1;
      if (b.startsAt) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });

  return (
    <>
      <Nav minimal />
      <main className="mx-auto max-w-7xl px-6 pt-24 pb-16">
        <header className="mb-8">
          <h1 className="text-headline-md text-on-surface mb-2">All Talks</h1>
          <p className="text-label-md text-on-surface-variant">
            {talks.length} talks with transcripts
          </p>
        </header>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {talks.map((talk) => (
            <Link key={talk.rkey} href={`/talk/${talk.rkey}`}>
              <LumeCard className="h-full">
                <div className="p-5">
                  {talk.speakers.length > 0 && (
                    <p className="text-label-md text-primary-fixed-dim mb-2">
                      {talk.speakers.map((s) => s.name).join(", ")}
                    </p>
                  )}
                  <h2 className="text-headline-sm text-on-surface mb-3">
                    {talk.title}
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {talk.room && <Chip>{talk.room}</Chip>}
                    <Chip>{formatDuration(talk.durationMs)}</Chip>
                  </div>
                </div>
              </LumeCard>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
