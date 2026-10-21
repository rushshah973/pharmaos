// Service errors carry the API error code and HTTP status (implementationplan.md §8),
// so route handlers can turn them into the { error: { code, message, details? } } envelope.
export class ServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const notFound = (what: "Plan" | "Line", id: string) =>
  new ServiceError(what === "Plan" ? "PLAN_NOT_FOUND" : "LINE_NOT_FOUND", 404, `${what} ${id} was not found.`);
