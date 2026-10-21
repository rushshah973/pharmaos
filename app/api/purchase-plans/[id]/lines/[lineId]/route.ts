import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { handle, parseBody } from "@/lib/api/http";
import { editLine } from "@/lib/services/plans";
import { patchLineBody, toLineChange, uuid } from "@/lib/validation/api";

// PATCH /api/purchase-plans/[id]/lines/[lineId] — one change; `preview: true` returns before/after unsaved (§7.3).
export async function PATCH(req: Request, ctx: RouteContext<"/api/purchase-plans/[id]/lines/[lineId]">) {
  return handle(async () => {
    const { id, lineId } = await ctx.params;
    if (!uuid.safeParse(id).success) throw notFound("Plan", id);
    if (!uuid.safeParse(lineId).success) throw notFound("Line", lineId);
    const body = await parseBody(req, patchLineBody, "INVALID_CHANGE");
    const result = await editLine(id, lineId, toLineChange(body), { preview: body.preview });
    return NextResponse.json(result);
  });
}
