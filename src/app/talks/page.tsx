import * as fs from "fs";
import * as path from "path";
import { Nav } from "@/components/ui/nav";
import { ScoredTalksGrid } from "@/components/scored-talks-grid";
import { getAuthUser } from "@/lib/auth/user";
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

export default async function TalksPage() {
  const user = await getAuthUser();
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
      <Nav minimal user={user} />
      <main className="mx-auto max-w-7xl px-6 pt-24 pb-16">
        <header className="mb-8">
          <h1 className="text-headline-md text-on-surface mb-2">All Talks</h1>
          <p className="text-label-md text-on-surface-variant">
            {talks.length} talks with transcripts
          </p>
        </header>

        <ScoredTalksGrid talks={talks} />
      </main>
    </>
  );
}
