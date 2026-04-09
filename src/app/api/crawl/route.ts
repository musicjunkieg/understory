import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { crawl } from "@/lib/crawl/crawler";
import {
  getCached,
  setCached,
  getInFlightCrawl,
  setInFlightCrawl,
} from "@/lib/crawl/cache";

const TIMEOUT_MS = 30_000;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get("force") === "true";

  // Check cache
  if (!force) {
    const cached = getCached(session.did);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }
  }

  // Check for in-flight crawl
  const inFlight = getInFlightCrawl(session.did);
  if (inFlight) {
    try {
      const result = await inFlight;
      return NextResponse.json({ ...result, cached: true });
    } catch {
      // In-flight failed, start a new one below
    }
  }

  // Start crawl with timeout
  const crawlPromise = crawl(session.agent, session.did);
  setInFlightCrawl(session.did, crawlPromise);

  try {
    const result = await Promise.race([
      crawlPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Crawl timeout")), TIMEOUT_MS),
      ),
    ]);

    setCached(session.did, result);
    return NextResponse.json({ ...result, cached: false });
  } catch (error) {
    console.error("Crawl failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Crawl failed",
        partial: true,
      },
      { status: 500 },
    );
  }
}
