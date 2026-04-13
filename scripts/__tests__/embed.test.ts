import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { decideWork, MODEL } from "../embed";
import { validateBatchResponse } from "../embed";
import type { VoyageEmbedResponse } from "../lib/embedding-types";

function hashOf(text: string): string {
  return "sha256-" + createHash("sha256").update(text).digest("hex");
}

describe("decideWork", () => {
  it("queues a talk when no embedding file exists", () => {
    const result = decideWork({
      rkey: "abc",
      transcriptText: "hello world",
      existing: null,
    });
    expect(result.action).toBe("queue");
    if (result.action !== "queue") return; // type narrow
    expect(result.text).toBe("hello world");
    expect(result.transcriptHash).toBe(hashOf("hello world"));
    expect(result.truncated).toBe(false);
  });

  it("skips when existing file matches hash AND model", () => {
    const text = "hello world";
    const result = decideWork({
      rkey: "abc",
      transcriptText: text,
      existing: {
        rkey: "abc",
        model: MODEL,
        dimensions: 1024,
        vector: new Array(1024).fill(0),
        transcriptHash: hashOf(text),
        truncated: false,
        generatedAt: "2026-04-13T00:00:00.000Z",
      },
    });
    expect(result.action).toBe("skip");
  });

  it("queues when existing file has a different hash (transcript changed)", () => {
    const result = decideWork({
      rkey: "abc",
      transcriptText: "new content",
      existing: {
        rkey: "abc",
        model: MODEL,
        dimensions: 1024,
        vector: new Array(1024).fill(0),
        transcriptHash: hashOf("old content"),
        truncated: false,
        generatedAt: "2026-04-13T00:00:00.000Z",
      },
    });
    expect(result.action).toBe("queue");
  });

  it("queues when existing file has a different model (model upgrade)", () => {
    const text = "hello world";
    const result = decideWork({
      rkey: "abc",
      transcriptText: text,
      existing: {
        rkey: "abc",
        model: "voyage-2-old",
        dimensions: 1024,
        vector: new Array(1024).fill(0),
        transcriptHash: hashOf(text),
        truncated: false,
        generatedAt: "2026-04-13T00:00:00.000Z",
      },
    });
    expect(result.action).toBe("queue");
  });

  it("returns noText action when transcript is empty", () => {
    const result = decideWork({
      rkey: "abc",
      transcriptText: "",
      existing: null,
    });
    expect(result.action).toBe("noText");
  });

  it("returns noText action when transcript text is only whitespace", () => {
    const result = decideWork({
      rkey: "abc",
      transcriptText: "   \n  \t  ",
      existing: null,
    });
    expect(result.action).toBe("noText");
  });

  it("truncates when transcript exceeds SAFE_CHAR_LIMIT", () => {
    const longText = "a".repeat(150_000);
    const result = decideWork({
      rkey: "abc",
      transcriptText: longText,
      existing: null,
    });
    expect(result.action).toBe("queue");
    if (result.action !== "queue") return;
    expect(result.text.length).toBe(120_000);
    expect(result.truncated).toBe(true);
  });

  it("hashes the truncated text, not the raw text, so re-runs stay idempotent", () => {
    const longText = "a".repeat(150_000);
    const result = decideWork({
      rkey: "abc",
      transcriptText: longText,
      existing: null,
    });
    if (result.action !== "queue") return;
    const expectedHash =
      "sha256-" + createHash("sha256").update("a".repeat(120_000)).digest("hex");
    expect(result.transcriptHash).toBe(expectedHash);
  });

  it("does not truncate when transcript is exactly at the limit", () => {
    const text = "a".repeat(120_000);
    const result = decideWork({
      rkey: "abc",
      transcriptText: text,
      existing: null,
    });
    if (result.action !== "queue") return;
    expect(result.truncated).toBe(false);
  });
});

describe("validateBatchResponse", () => {
  function makeResponse(items: number): VoyageEmbedResponse {
    return {
      data: Array.from({ length: items }, (_, i) => ({
        embedding: new Array(1024).fill(0.1),
        index: i,
      })),
      model: "voyage-3.5-lite",
      usage: { total_tokens: 1000 },
    };
  }

  it("accepts a well-formed response that matches the expected batch size", () => {
    expect(() => validateBatchResponse(makeResponse(3), 3)).not.toThrow();
  });

  it("throws when data length does not match expected batch size", () => {
    expect(() => validateBatchResponse(makeResponse(2), 3)).toThrow(
      /length mismatch/i,
    );
  });

  it("throws when an index is out of range", () => {
    const response = makeResponse(3);
    response.data[0].index = 99;
    expect(() => validateBatchResponse(response, 3)).toThrow(/index/i);
  });

  it("throws when index coverage has duplicates", () => {
    const response = makeResponse(3);
    response.data[0].index = 1;
    response.data[1].index = 1;
    expect(() => validateBatchResponse(response, 3)).toThrow(/duplicate/i);
  });

  it("throws when a vector has wrong dimension count", () => {
    const response = makeResponse(2);
    response.data[0].embedding = new Array(512).fill(0.1);
    expect(() => validateBatchResponse(response, 2)).toThrow(/dimension/i);
  });

  it("throws when a vector contains a non-finite number", () => {
    const response = makeResponse(1);
    response.data[0].embedding[0] = NaN;
    expect(() => validateBatchResponse(response, 1)).toThrow(/finite/i);
  });

  it("throws when data is missing entirely", () => {
    const malformed = { model: "voyage-3.5-lite", usage: { total_tokens: 0 } };
    expect(() =>
      validateBatchResponse(malformed as VoyageEmbedResponse, 1),
    ).toThrow(/data/i);
  });
});
