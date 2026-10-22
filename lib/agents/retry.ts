// Gemini sometimes answers 503 (overloaded), 504 (deadline expired), 429 (rate limit) or 500/502 for a moment.
// One such reply used to end a whole agent run in fallback. These are retried a couple of times with a short
// backoff before giving up; any other error (bad key, bad request) fails at once.
import { ApiError } from "@google/genai";

/** Used when GEMINI_MODEL is not set: the fast model that answered reliably in testing (gemini-flash-latest
 * returned 504 DEADLINE_EXCEEDED repeatedly on 22 Oct). */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";

export const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
/** Waits before the 1st and 2nd retry. */
export const RETRY_DELAYS_MS = [1000, 3000] as const;

export function isTransient(err: unknown): boolean {
  return err instanceof ApiError && TRANSIENT_STATUS.has(err.status);
}

export async function withRetry<T>(call: () => Promise<T>, delays: readonly number[] = RETRY_DELAYS_MS, onRetry?: (err: unknown, attempt: number) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (!isTransient(err) || attempt >= delays.length) throw err;
      onRetry?.(err, attempt + 1);
      if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
