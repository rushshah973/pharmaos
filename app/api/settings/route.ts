import { connection, NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api/http";
import { updateApprovalLimit } from "@/lib/services/scenarios";
import { settingsBody } from "@/lib/validation/api";

// PATCH /api/settings { poApprovalLimit } — the Owner approval limit (audit settings.approval_limit_changed).
export async function PATCH(req: Request) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { poApprovalLimit } = await parseBody(req, settingsBody);
    return NextResponse.json(await updateApprovalLimit(poApprovalLimit));
  });
}
