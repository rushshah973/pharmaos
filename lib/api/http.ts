import { NextResponse } from "next/server";
import type { z } from "zod";
import { ServiceError } from "./errors";

export type ErrorBody = { error: { code: string; message: string; details?: unknown } };

export function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json<ErrorBody>({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });
}

/** Parses a JSON body with a Zod schema; throws a 400 ServiceError on bad JSON or a failed parse. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S, code = "VALIDATION_ERROR"): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new ServiceError("INVALID_JSON", 400, "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new ServiceError(code, 400, issues[0]?.message ?? "Invalid request.", issues);
  }
  return parsed.data;
}

/** Runs a handler and maps errors onto the §8 envelope. Unknown errors are 500 INTERNAL. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceError) return errorResponse(err.code, err.message, err.status, err.details);
    console.error("[api] unhandled error", err);
    return errorResponse("INTERNAL", "Something went wrong. Try again.", 500);
  }
}
