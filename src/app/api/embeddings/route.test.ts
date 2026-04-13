import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";

vi.mock("node:fs");

// Sample files the mocked fs should return.
const SAMPLE_FILES = [
  "3mi54oonum62b.json",
  "3mi56m3hnrq2z.json",
];

const SAMPLE_CONTENTS: Record<string, unknown> = {
  "3mi54oonum62b.json": {
    rkey: "3mi54oonum62b",
    model: "voyage-3.5-lite",
    dimensions: 1024,
    vector: new Array(1024).fill(0.1),
    transcriptHash: "sha256-abc",
    truncated: false,
    generatedAt: "2026-04-13T00:00:00.000Z",
  },
  "3mi56m3hnrq2z.json": {
    rkey: "3mi56m3hnrq2z",
    model: "voyage-3.5-lite",
    dimensions: 1024,
    vector: new Array(1024).fill(0.2),
    transcriptHash: "sha256-def",
    truncated: false,
    generatedAt: "2026-04-13T00:00:00.000Z",
  },
};

describe("GET /api/embeddings", () => {
  beforeEach(() => {
    vi.mocked(fs.readdirSync).mockReturnValue(
      SAMPLE_FILES as unknown as ReturnType<typeof fs.readdirSync>,
    );
    vi.mocked(fs.readFileSync).mockImplementation((path) => {
      const filename = String(path).split("/").pop()!;
      return JSON.stringify(SAMPLE_CONTENTS[filename]);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an aggregated Record<rkey, number[]> with immutable cache headers", async () => {
    // Import inside the test so the module-level cache gets rebuilt fresh
    // per test run (vitest resets module graph between test files but not
    // within one file).
    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);

    const cacheControl = response.headers.get("Cache-Control");
    expect(cacheControl).toContain("max-age=31536000");
    expect(cacheControl).toContain("immutable");

    const body = (await response.json()) as Record<string, number[]>;
    expect(Object.keys(body)).toEqual([
      "3mi54oonum62b",
      "3mi56m3hnrq2z",
    ]);
    expect(body["3mi54oonum62b"]).toHaveLength(1024);
    expect(body["3mi54oonum62b"][0]).toBeCloseTo(0.1, 10);
    expect(body["3mi56m3hnrq2z"][0]).toBeCloseTo(0.2, 10);
  });
});
