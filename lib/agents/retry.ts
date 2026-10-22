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
export const CALL_TIMEOUT_MS = 45_000;
/** A call still unanswered after this also goes to the backup model; the first answer wins. A normal turn takes
 * 2–8 s, so this only fires when Google is slow. */
export const HEDGE_AFTER_MS = 10_000;

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

/** Starts call(models[0]); if it fails with a transient error, or has not answered after hedgeAfterMs, the next model
 * is started too. The first answer wins and the other request is aborted; it fails only when every started request
 * failed (with the last error). */
export function hedged<T>(models: string[], call: (model: string, signal: AbortSignal) => Promise<T>, hedgeAfterMs = HEDGE_AFTER_MS): Promise<{ value: T; model: string }> {
  return new Promise((resolve, reject) => {
    const controllers: AbortController[] = [];
    let next = 0;
    let pending = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      done = true;
      clearTimeout(timer);
    };
    const start = () => {
      const model = models[next++];
      const controller = new AbortController();
      controllers.push(controller);
      pending++;
      call(model, controller.signal).then(
        (value) => {
          if (done) return;
          settle();
          for (const c of controllers) if (c !== controller) c.abort();
          resolve({ value, model });
        },
        (err) => {
          pending--;
          if (done) return;
          if (next < models.length && isTransient(err)) start();
          else if (pending === 0) {
            settle();
            reject(err);
          }
        },
      );
      clearTimeout(timer);
      if (next < models.length) timer = setTimeout(() => !done && next < models.length && start(), hedgeAfterMs);
    };
    start();
  });
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
