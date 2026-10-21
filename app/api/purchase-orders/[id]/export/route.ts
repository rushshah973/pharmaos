import { ServiceError } from "@/lib/api/errors";
import { handle } from "@/lib/api/http";
import { exportPo } from "@/lib/services/purchase-orders";
import { uuid } from "@/lib/validation/api";

// POST /api/purchase-orders/[id]/export — CSV download in any status; the status does not change.
export async function POST(_req: Request, ctx: RouteContext<"/api/purchase-orders/[id]/export">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw new ServiceError("PO_NOT_FOUND", 404, `Purchase order ${id} was not found.`);
    const { filename, csv } = await exportPo(id);
    return new Response(csv, {
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" },
    });
  });
}
