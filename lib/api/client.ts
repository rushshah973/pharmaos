// Browser-side calls to the PharmaOS API. Errors carry the server's message from the §8 envelope.
export async function apiCall<T>(url: string, method: "POST" | "PATCH", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (HTTP ${res.status}).`);
  return json as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");
