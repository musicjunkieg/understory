import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./cosine";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("is magnitude-invariant", () => {
    expect(cosineSimilarity([2, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([10, 0, 0], [0.1, 0, 0])).toBeCloseTo(1, 10);
  });

  it("accepts mixed Float32Array and number[] inputs", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it("returns 0 when either vector has zero magnitude", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it("throws with the exact contracted message on length mismatch", () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrow(
      "cosine: length mismatch 3 vs 2",
    );
  });
});
