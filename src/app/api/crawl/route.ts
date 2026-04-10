import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { crawl } from "@/lib/crawl/crawler";
import { getCached, setCached, registerCrawl } from "@/lib/crawl/cache";
import type { CrawlResult } from "@/lib/crawl/types";

const TIMEOUT_MS = 30_000;

/**
 * Race a promise against a timeout. Clears the timer when the primary promise
 * settles so we don't leak a pending setTimeout.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Crawl timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

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

  // Atomically register or join a crawl. If `isNew`, this request owns the
  // signal and a timeout abort will actually cancel outbound fetches. If we
  // joined an existing crawl, we can't abort someone else's work — so we wrap
  // our wait in a separate timeout that only bounds THIS request's latency.
  const { promise: crawlPromise, isNew } = registerCrawl(session.did, () =>
    crawl(session.agent, session.did, AbortSignal.timeout(TIMEOUT_MS)),
  );

  try {
    const result: CrawlResult = isNew
      ? await crawlPromise
      : await withTimeout(crawlPromise, TIMEOUT_MS);

    setCached(session.did, result);
    return NextResponse.json({ ...result, cached: !isNew });
  } catch (error) {
    console.error("Crawl failed:", error);
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || // AbortSignal.timeout fires a DOMException named TimeoutError
        /timeout/i.test(error.message)); // withTimeout() helper rejects with "Crawl timeout"
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Crawl failed",
        partial: true,
      },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
