// Gemini sometimes answers 503 (overloaded), 504 (deadline expired), 429 (rate limit) or 500/502 for a moment.
// One such reply used to end a whole agent run in fallback. These are retried a couple of times with a short
// backoff before giving up; any other error (bad key, bad request) fails at once. A retry goes to the other model
// (see modelChain): when Google overloads one model, the other usually still answers in a few seconds.
import { ApiError } from "@google/genai";

/** Used when GEMINI_MODEL is not set. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";
/** Tried when the configured model is overloaded or slow. On 22 Oct each one took turns: gemini-flash-latest
 * returned 504 for a while, later gemini-flash-lite-latest returned 503 "high demand" and took 39 s to say "ok". */
export const BACKUP_GEMINI_MODEL = "gemini-flash-latest";
/** Per-call deadline. The SDK sends it to Gemini as X-Server-Timeout, so a call past it comes back as 504. */
export const CALL_TIMEOUT_MS = 30_000;

/** The models to try, in order: the configured one, then the backup. */
export function modelChain(primary: string): string[] {
  return primary === BACKUP_GEMINI_MODEL ? [primary] : [primary, BACKUP_GEMINI_MODEL];
}

/** A client-side timeout (no HTTP status): retried like a 504. */
function isTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : "";
  return !(err instanceof ApiError) && /abort|timeout|timed out/i.test(msg);
}

export const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
/** Waits before the 1st and 2nd retry. */
export const RETRY_DELAYS_MS = [1000, 3000] as const;

export function isTransient(err: unknown): boolean {
  return (err instanceof ApiError && TRANSIENT_STATUS.has(err.status)) || isTimeout(err);
}

/** `call` gets the attempt number (0 first), so a retry can switch model. */
export async function withRetry<T>(call: (attempt: number) => Promise<T>, delays: readonly number[] = RETRY_DELAYS_MS, onRetry?: (err: unknown, attempt: number) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call(attempt);
    } catch (err) {
      if (!isTransient(err) || attempt >= delays.length) throw err;
      onRetry?.(err, attempt + 1);
      if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
