import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { decideWork, MODEL } from "../embed";

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
