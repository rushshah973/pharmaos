// Browser-side calls to the PharmaOS API. Errors carry the server's code and message from the §8 envelope.
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiCall<T>(url: string, method: "POST" | "PATCH", body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string; details?: unknown } }) | null;
  if (!res.ok) {
    throw new ApiError(json?.error?.code ?? "HTTP_ERROR", res.status, json?.error?.message ?? `Request failed (HTTP ${res.status}).`, json?.error?.details);
  }
  return json as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");
