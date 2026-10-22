import { connection, NextResponse } from "next/server";
import { handle } from "@/lib/api/http";
import { trainAndStoreModel } from "@/lib/services/forecast-model";

// Training reads 90 days of sales for every SKU and fits the model: allow up to 300 s on Vercel.
export const maxDuration = 300;

// POST /api/forecast-model/train — retrain the demand model from the Data & Scenarios screen (§10.3; the
// training service audits model.trained). Returns the new model's metrics.
export async function POST() {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { model, ms } = await trainAndStoreModel({ type: "user", id: process.env.DEMO_USER ?? "demo.owner" });
    return NextResponse.json({ id: model.id, trainedAt: model.trainedAt, metrics: model.metrics, ms });
  });
}
