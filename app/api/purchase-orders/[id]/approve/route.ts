import { NextResponse, after } from "next/server";
import { ServiceError } from "@/lib/api/errors";
import { handle, parseBody } from "@/lib/api/http";
import { notifyOwnerOfApprovedPo } from "@/lib/services/notify";
import { AGENT_SENDER, approvePo, createdByAgents, sendPo } from "@/lib/services/purchase-orders";
import { approvePoBody, uuid } from "@/lib/validation/api";

// POST /api/purchase-orders/[id]/approve — Owner approval: pending_approval → approved. A PO the agent run created
// is then sent at once (simulated), as the run sends its other POs; a PO from a person's approval waits for Send.
export async function POST(req: Request, ctx: RouteContext<"/api/purchase-orders/[id]/approve">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw new ServiceError("PO_NOT_FOUND", 404, `Purchase order ${id} was not found.`);
    const body = await parseBody(req, approvePoBody);
    const approved = await approvePo(id, { note: body.note });
    if (await createdByAgents(id)) {
      const sent = await sendPo(id, AGENT_SENDER);
      after(() => notifyOwnerOfApprovedPo(id)); // after the response: the Owner's click never waits on email
      return NextResponse.json(sent);
    }
    return NextResponse.json(approved);
  });
}
