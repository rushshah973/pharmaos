// The Gemini model chain: a model out of quota (429) or retired (404) is skipped until it can answer again, so a run
// moves straight to the next model instead of failing.
import { ApiError } from "@google/genai";
import { afterEach, describe, expect, it } from "vitest";
import { modelChain, noteModelFailure } from "@/lib/agents/retry";

describe("model chain", () => {
  afterEach(() => {
    delete process.env.GEMINI_BACKUP_MODELS;
  });

  it("tries the configured model first, then the backups, without repeating it", () => {
    process.env.GEMINI_BACKUP_MODELS = "b1, a1, b2";
    expect(modelChain("a1")).toEqual(["a1", "b1", "b2"]);
  });

  it("skips a model out of quota until Google's retry time, and a retired model", () => {
    process.env.GEMINI_BACKUP_MODELS = "q-b1,q-b2";
    noteModelFailure("q-a", new ApiError({ status: 429, message: '{"error":{"details":[{"retryDelay":"52300s"}]}}' }));
    noteModelFailure("q-b1", new ApiError({ status: 404, message: "no longer available" }));
    expect(modelChain("q-a")).toEqual(["q-b2"]);
  });

  it("an overloaded model (503) is not skipped later: overload passes quickly", () => {
    process.env.GEMINI_BACKUP_MODELS = "o-b";
    noteModelFailure("o-a", new ApiError({ status: 503, message: "high demand" }));
    expect(modelChain("o-a")).toEqual(["o-a", "o-b"]);
  });

  it("when every model is cooling down, all are tried rather than none", () => {
    process.env.GEMINI_BACKUP_MODELS = "c-b";
    noteModelFailure("c-a", new ApiError({ status: 429, message: "quota" }));
    noteModelFailure("c-b", new ApiError({ status: 429, message: "quota" }));
    expect(modelChain("c-a")).toEqual(["c-a", "c-b"]);
  });
});
