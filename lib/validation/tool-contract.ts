// Every business tool (used by the API routes and by the AI orchestrator)
// returns this shape. The model may explain only from `data`.
export type ToolWarning = { code: string; message: string };

export type ToolOk<T> = {
  ok: true;
  data: T;
  warnings: ToolWarning[];
  source_timestamp: string; // ISO-8601
};

export type ToolError = {
  ok: false;
  error: { code: string; message: string };
  warnings: ToolWarning[];
  source_timestamp: string;
};

export type ToolResult<T> = ToolOk<T> | ToolError;

export function toolOk<T>(data: T, warnings: ToolWarning[] = []): ToolOk<T> {
  return { ok: true, data, warnings, source_timestamp: new Date().toISOString() };
}

export function toolError(code: string, message: string, warnings: ToolWarning[] = []): ToolError {
  return { ok: false, error: { code, message }, warnings, source_timestamp: new Date().toISOString() };
}
