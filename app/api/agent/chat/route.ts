import { connection, NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api/http";
import { runAgent } from "@/lib/agents/orchestrator";
import { chatBody } from "@/lib/validation/api";

// POST /api/agent/chat — Ask PharmaOS. Never 503: any AI failure falls back to a deterministic answer.
export async function POST(req: Request) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const body = await parseBody(req, chatBody);
    const { reply, toolCalls, references, source, fallbackReason } = await runAgent(body);
    return NextResponse.json({ reply, toolCalls, references, source, ...(fallbackReason ? { fallbackReason } : {}) });
  });
}
