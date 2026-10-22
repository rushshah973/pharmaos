"use client";

// Ask PharmaOS (§9.1, §10.3): a side panel on the plan screen. Replies come from the agent (source AI) or, when the
// AI is unavailable, from calculated figures (source Calculated). References open the line drawer (SKU), the
// warehouse (bin) or the purchase orders (supplier). The agent can read and recalculate; it cannot approve, reject,
// create or send purchase orders.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Boxes, FileText, Info, Package, Sparkles, Wrench } from "lucide-react";
import { cn } from "cn";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { apiCall, errorMessage } from "@/lib/api/client";
import { requestLine } from "@/components/procurement/drawer/line-store";
import { RichText, SourceTag } from "./RichText";

type Reference = { type: "product" | "line" | "bin" | "plan" | "supplier"; id: string; label: string };
type ChatResponse = { reply: string; toolCalls: { name: string; ok: boolean; ms: number }[]; references: Reference[]; source: "agent" | "deterministic"; fallbackReason?: string };
type Message = { id: number; role: "user" } & { text: string } | ({ id: number; role: "assistant"; pending?: boolean; error?: string } & Partial<ChatResponse>);

const TOOL_LABEL: Record<string, string> = {
  search_products: "product search",
  get_sales_history: "sales history",
  get_inventory_position: "stock position",
  forecast_demand: "demand forecast",
  calculate_reorder_qty: "reorder maths",
  get_batches: "batches",
  calculate_expiry_exposure: "expiry exposure",
  get_return_policy: "return policy",
  get_supplier_offers: "supplier offers",
  compare_supplier_offers: "supplier comparison",
  get_price_history: "price history",
  get_po_projection: "PO projection",
  get_plan: "the plan",
  build_plan_preview: "plan preview",
  recalculate_plan: "recalculation",
  validate_po: "PO checks",
  get_bin_details: "bin details",
  get_heatmap_metrics: "warehouse heatmap",
  suggest_candidate_bin: "put-away",
};

/** The 7 Appendix A demo prompts, filled with the line in focus (the open drawer's line, else the top-ranked line). */
function demoPrompts(focus: { sku: string; id: string } | null): string[] {
  const sku = focus?.sku ?? "the top-ranked SKU";
  return [
    "Create today's purchase plan. Prioritise products likely to run out before the supplier can deliver.",
    `Why did you choose Supplier B instead of Supplier A for ${sku}?`,
    "Which supplier POs will need Owner approval, and why?",
    `Show where ${sku} and its batches are located in the warehouse.`,
    "Show expiry risk in the warehouse and identify affected purchase recommendations.",
    `Change the order for ${sku}${focus ? ` (line ${focus.id})` : ""} to 60 packs and recalculate the total, the supplier's PO total and MOQ/pack constraints.`,
    "Prepare POs for approved lines and send them.",
  ];
}

export function AskPanel({ planId, lines }: { planId: string; lines: { id: string; sku: string; rank: number }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const lineBySku = new Map(lines.map((l) => [l.sku.toUpperCase(), l.id]));
  const openLineId = params.get("line");
  const focus = (openLineId && lines.find((l) => l.id === openLineId)) || [...lines].sort((a, b) => a.rank - b.rank)[0] || null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function ask(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const userId = nextId.current++;
    const replyId = nextId.current++;
    setMessages((m) => [...m, { id: userId, role: "user", text: message }, { id: replyId, role: "assistant", pending: true }]);
    setDraft("");
    setBusy(true);
    try {
      const r = await apiCall<ChatResponse>("/api/agent/chat", "POST", { message, planId });
      setMessages((m) => m.map((x) => (x.id === replyId ? { id: replyId, role: "assistant", ...r } : x)));
      // A recalculation changes the plan on screen: refresh the server components behind the panel.
      if (r.toolCalls.some((t) => t.name === "recalculate_plan" && t.ok)) router.refresh();
    } catch (err) {
      setMessages((m) => m.map((x) => (x.id === replyId ? { id: replyId, role: "assistant", error: errorMessage(err) } : x)));
    } finally {
      setBusy(false);
    }
  }

  const openSku = (sku: string) => {
    const lineId = lineBySku.get(sku.toUpperCase());
    if (!lineId) return false;
    requestLine(lineId);
    router.push(`?line=${lineId}`, { scroll: false });
    setOpen(false);
    return true;
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-brand/30 bg-brand-glow px-3.5 text-[13px] font-medium text-fg-1 transition-colors hover:border-brand/50 hover:bg-brand/15"
          />
        }
      >
        <Sparkles className="size-4 text-brand" strokeWidth={1.75} aria-hidden /> Ask PharmaOS
      </SheetTrigger>
      <SheetContent side="right" className="w-[520px] max-w-[calc(100vw-2rem)] gap-0 border-l border-border-strong bg-surface-2 p-0 shadow-(--shadow-pop) data-[side=right]:sm:max-w-[520px]">
        <div className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle className="flex items-center gap-2 text-[15px] font-semibold text-fg-1">
            <Sparkles className="size-4 text-brand" strokeWidth={1.75} aria-hidden /> Ask PharmaOS
          </SheetTitle>
          <SheetDescription className="mt-0.5 text-[12.5px] text-fg-3">
            Answers come from the plan&apos;s data through read-only tools. It cannot approve, reject or send purchase orders.
          </SheetDescription>
        </div>

        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="micro-label">Try one of these</p>
              <ul className="space-y-1.5">
                {demoPrompts(focus).map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => ask(p)}
                      className="w-full rounded-lg border border-border bg-surface-1 px-3 py-2 text-left text-[12.5px] leading-[18px] text-fg-2 transition-colors hover:border-border-strong hover:bg-white/[0.04] hover:text-fg-1"
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="ml-10 rounded-xl rounded-br-sm bg-brand-glow px-3.5 py-2.5 text-[13.5px] leading-5 text-fg-1 ring-1 ring-brand/20">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className="mr-4 rounded-xl rounded-bl-sm border border-border bg-surface-1 px-4 py-3">
                {m.pending ? (
                  <div className="space-y-2" aria-label="PharmaOS is thinking">
                    <p className="text-[12px] text-fg-3">Checking the plan&apos;s data…</p>
                    <span className="shimmer block h-4 w-full rounded" />
                    <span className="shimmer block h-4 w-4/5 rounded" />
                  </div>
                ) : m.error ? (
                  <p className="text-[13px] text-stockout">{m.error}</p>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <SourceTag source={m.source!} />
                      {m.toolCalls && m.toolCalls.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11.5px] text-fg-3">
                          <Wrench className="size-3" aria-hidden /> Checked {[...new Set(m.toolCalls.map((t) => TOOL_LABEL[t.name] ?? t.name))].join(", ")}
                        </span>
                      )}
                    </div>
                    <RichText text={m.reply ?? ""} planId={planId} />
                    {m.source === "deterministic" && (
                      <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-surface-2 px-2.5 py-2 text-[11.5px] leading-4 text-fg-3">
                        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                        AI unavailable{m.fallbackReason ? ` (${m.fallbackReason})` : ""}, so this answer shows calculated figures from the plan.
                      </p>
                    )}
                    <References refs={m.references ?? []} onSku={openSku} onWarehouseSku={(sku) => router.push(`/warehouse?sku=${encodeURIComponent(sku)}`)} />
                  </>
                )}
              </div>
            ),
          )}
        </div>

        <form
          className="border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border border-border-strong bg-surface-1 p-2 focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/20">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(draft);
                }
              }}
              rows={2}
              placeholder="Ask about this plan, a SKU, a supplier or the warehouse…"
              aria-label="Your question"
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1.5 py-1 text-[13.5px] leading-5 text-fg-1 outline-none placeholder:text-fg-3"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-strong text-[#04221d] transition-colors hover:bg-brand disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowUp className="size-4" strokeWidth={2.25} />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-fg-3">Enter to send · Shift+Enter for a new line · synthetic demo data</p>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function References({ refs, onSku, onWarehouseSku }: { refs: Reference[]; onSku: (sku: string) => boolean; onWarehouseSku: (sku: string) => void }) {
  const shown = refs.filter((r) => r.type !== "plan").slice(0, 8);
  if (shown.length === 0) return null;
  const chip = "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-fg-2 transition-colors hover:border-border-strong hover:text-fg-1";
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
      {shown.map((r) =>
        r.type === "product" ? (
          <ProductRef key={`${r.type}${r.id}`} r={r} onSku={onSku} onWarehouseSku={onWarehouseSku} className={chip} />
        ) : r.type === "bin" ? (
          <Link key={`${r.type}${r.id}`} href={`/warehouse?bin=${encodeURIComponent(r.id)}`} className={chip}>
            <Boxes className="size-3.5 text-fg-3" aria-hidden /> {r.label}
          </Link>
        ) : (
          <Link key={`${r.type}${r.id}`} href="/purchase-orders" className={chip}>
            <FileText className="size-3.5 text-fg-3" aria-hidden /> {r.label}
          </Link>
        ),
      )}
    </div>
  );
}

function ProductRef({ r, onSku, onWarehouseSku, className }: { r: Reference; onSku: (sku: string) => boolean; onWarehouseSku: (sku: string) => void; className: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        // A SKU in this plan opens its line drawer; any other SKU opens the warehouse locator.
        if (!onSku(r.id)) onWarehouseSku(r.id);
      }}
      className={cn(className, "font-mono")}
    >
      <Package className="size-3.5 text-fg-3" aria-hidden /> {r.label}
    </button>
  );
}
