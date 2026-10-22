"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, CircleCheck, CircleX, History, Loader2, PackageCheck, ShieldAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { type PillStatus, StatusPill } from "@/components/layout/StatusPill";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { formatDateTime } from "@/lib/format/date";
import { formatINR } from "@/lib/money";
import type { AgentRun } from "@/lib/services/agent-runs";
import { AGENTS, type AgentState, type RunWithSteps, agentHeadline, agentState, decisions, madeNoChanges, orderResult, toolResult } from "./run-view";

const POLL_MS = 2000;
const FALLBACK_TEXT = "AI unavailable — no changes were made. Review the plan and approve manually.";

const RUN_PILL: Record<AgentRun["status"], { tone: PillStatus; label: string }> = {
  running: { tone: "expiry", label: "Running" },
  succeeded: { tone: "healthy", label: "Finished" },
  fallback: { tone: "neutral", label: "AI unavailable" },
  failed: { tone: "stockout", label: "Failed" },
};
const AGENT_PILL: Record<AgentState, { tone: PillStatus; label: string }> = {
  waiting: { tone: "neutral", label: "Waiting" },
  thinking: { tone: "expiry", label: "Thinking" },
  done: { tone: "healthy", label: "Done" },
  fallback: { tone: "neutral", label: "Fallback" },
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (HTTP ${res.status}).`);
  return json as T;
}

/**
 * Agent Run panel (§9.5, §10.3): the three agents in order with their status, tool timeline and decisions, then
 * the results. Polls the run every 2 s while it is running; when it finishes the plan screen refreshes so the
 * table, Impact Card and supplier POs show the agents' changes. Past runs of the plan are listed below.
 */
export function AgentRunPanel({
  planId,
  runId,
  open,
  onOpenChange,
  onSelectRun,
  onFinished,
  follow = false,
}: {
  planId: string;
  runId: string | null;
  open: boolean;
  /** Keep polling while a run is active even when the panel is closed, so the page refreshes when it ends. */
  follow?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectRun: (runId: string) => void;
  onFinished: () => void;
}) {
  const router = useRouter();
  const [run, setRun] = useState<RunWithSteps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [past, setPast] = useState<AgentRun[]>([]);
  const [pastError, setPastError] = useState(false);
  const wasRunning = useRef(false);

  // Poll the selected run every 2 s until it is no longer running.
  useEffect(() => {
    if ((!open && !follow) || !runId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await getJson<RunWithSteps>(`/api/agents/runs/${runId}`);
        if (stop) return;
        setRun(r);
        setError(null);
        if (r.status === "running") {
          wasRunning.current = true;
          timer = setTimeout(tick, POLL_MS);
        } else if (wasRunning.current) {
          wasRunning.current = false;
          onFinished();
          router.refresh();
          if (r.status === "succeeded") toast.success("Agents finished", { description: r.summary?.slice(0, 160) ?? undefined });
          else if (r.status === "fallback") toast("AI unavailable", { description: "No changes were made. Review the plan and approve manually." });
          else toast.error("The agent run failed", { description: r.error ?? undefined });
        }
      } catch (err) {
        if (stop) return;
        setError(err instanceof Error ? err.message : "The run could not load.");
        timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [open, follow, runId, router, onFinished]);

  // Past runs: on open and whenever the shown run changes status.
  const status = run?.status;
  useEffect(() => {
    if (!open) return;
    let stop = false;
    getJson<{ runs: AgentRun[] }>(`/api/agents/runs?planId=${planId}`)
      .then((r) => {
        if (stop) return;
        setPast(r.runs);
        setPastError(false);
      })
      .catch(() => !stop && setPastError(true));
    return () => {
      stop = true;
    };
  }, [open, planId, status]);

  const shown = run && run.id === runId ? run : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[640px] max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto border-l border-border-strong bg-[rgba(18,18,21,0.92)] p-0 shadow-(--shadow-pop) backdrop-blur-2xl data-[side=right]:sm:max-w-[640px]"
      >
        <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[rgba(18,18,21,0.85)] px-6 pt-5 pb-4 backdrop-blur-xl">
          <div className="flex items-center gap-2.5 pr-8">
            <span className="glass-pill flex size-8 items-center justify-center text-brand">
              <Bot className="size-4" strokeWidth={1.6} aria-hidden />
            </span>
            <SheetTitle className="text-[18px] leading-6 font-normal tracking-[-0.02em] text-fg-1">Procurement agents</SheetTitle>
            {shown && <StatusPill status={RUN_PILL[shown.status].tone}>{RUN_PILL[shown.status].label}</StatusPill>}
          </div>
          <SheetDescription className="mt-1.5 text-[12.5px] text-fg-3">
            {shown
              ? `Started ${formatDateTime(shown.startedAt)} · top ${shown.skus.length || shown.maxSkus} proposed lines${shown.finishedAt ? ` · finished ${formatDateTime(shown.finishedAt)}` : ""}`
              : "The engine calculates, three agents decide within guardrails, POs within the limit are sent automatically (simulated) and the Owner approves large ones."}
          </SheetDescription>
        </header>

        <div className="space-y-5 px-6 py-5">
          <HowItWorks />
          {error && (
            <p role="alert" className="rounded-xl border border-stockout/30 bg-stockout-bg px-3 py-2 text-[12.5px] text-stockout">
              {error} Retrying…
            </p>
          )}
          {!runId && <p className="text-fg-2">No run selected. Start one with Run procurement agents, or open a past run below.</p>}
          {runId && !shown && !error && <PanelSkeleton />}
          {shown && (
            <>
              {shown.status === "fallback" && (
                <div className="flex gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[13px] text-fg-1">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-expiry" aria-hidden />
                  <span>
                    {madeNoChanges(shown) ? FALLBACK_TEXT : "AI unavailable part-way — the changes listed below were made before it stopped; no POs were created. Review the plan and approve manually."}
                  </span>
                </div>
              )}
              {shown.status === "failed" && (
                <p className="rounded-2xl border border-stockout/30 bg-stockout-bg px-4 py-3 text-[13px] text-stockout">The run stopped on a server error: {shown.error ?? "unknown error"}. Nothing after the error was applied.</p>
              )}
              {shown.status !== "running" && <Results run={shown} planId={planId} />}
              <ol className="space-y-3">
                {AGENTS.map((a, i) => (
                  <AgentCard key={a.name} run={shown} index={i} agent={a} planId={planId} />
                ))}
              </ol>
              {shown.status === "running" && <Results run={shown} planId={planId} />}
            </>
          )}
          {pastError && <p className="text-[12px] text-fg-3">Past runs could not load. Close and reopen the panel to try again.</p>}
          <PastRuns runs={past} currentId={runId} onSelect={onSelectRun} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Tool calls shown before "Show all": the latest ones, which is where a live run's action is. */
const TIMELINE_VISIBLE = 4;

function AgentCard({ run, index, agent, planId }: { run: RunWithSteps; index: number; agent: (typeof AGENTS)[number]; planId: string }) {
  const state = agentState(run, agent.name);
  const [allTools, setAllTools] = useState(false);
  const [allRows, setAllRows] = useState(false);
  const tools = run.steps.filter((s) => s.agent === agent.name && s.kind === "tool_call");
  const hidden = allTools ? 0 : Math.max(0, tools.length - TIMELINE_VISIBLE);
  const every = decisions(run, agent.name);
  // What matters first: the lines the agent changed and the decisions the guardrail refused; "kept" rows on request.
  const notable = every.filter((r) => r.changed || !r.accepted);
  const rows = allRows ? every : notable;
  const fallback = run.steps.find((s) => s.agent === agent.name && s.kind === "fallback");
  const lineOf = new Map(run.skus.map((s) => [s.sku, s.lineId]));
  return (
    <li className={cn("surface overflow-hidden", state === "thinking" && "border-expiry/30 shadow-[0_0_0_1px_rgba(242,201,76,0.15),var(--shadow-card)]")}>
      <div className="flex items-start gap-3 px-4 pt-4">
        <span className="num flex size-7 shrink-0 items-center justify-center rounded-full border border-white/10 text-[12px] text-fg-2">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[15px] leading-[22px] text-fg-1">{agent.title}</h3>
            <span className="flex items-center gap-1.5">
              {state === "thinking" && <Loader2 className="size-3.5 animate-spin text-expiry" aria-hidden />}
              <StatusPill status={AGENT_PILL[state].tone}>{AGENT_PILL[state].label}</StatusPill>
            </span>
          </div>
          <p className="text-[12px] text-fg-3">{agent.role}</p>
          <p className={cn("mt-2 text-[13.5px] leading-5", state === "done" ? "text-fg-1" : "text-fg-2")}>{agentHeadline(run, agent.name, state)}</p>
        </div>
      </div>

      {fallback && (
        <p className="mx-4 mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12.5px] text-fg-2">
          {String((fallback.output as { reason?: string } | null)?.reason ?? "AI unavailable")} · {String((fallback.output as { effect?: string } | null)?.effect ?? "No changes made.")}
        </p>
      )}

      {tools.length > 0 && (
        <details className="group/trace px-4 pt-3">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-[12px] text-fg-3 hover:text-fg-1 [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-3.5 transition-transform group-open/trace:rotate-180" aria-hidden />
            Technical trace · {tools.length} step{tools.length === 1 ? "" : "s"} (the data the agent read)
          </summary>
          <div className="mt-2 mb-1.5 flex items-center justify-between">
            <p className="micro-label">Tool calls · {tools.length}</p>
            {tools.length > TIMELINE_VISIBLE && (
              <button type="button" onClick={() => setAllTools((v) => !v)} className="text-[11.5px] text-fg-3 hover:text-fg-1">
                {allTools ? "Show the latest" : `Show all ${tools.length}`}
              </button>
            )}
          </div>
          {hidden > 0 && <p className="mb-1 pl-4 text-[11.5px] text-fg-3">{hidden} earlier call{hidden === 1 ? "" : "s"} hidden</p>}
          <ol className="relative space-y-1 border-l border-white/10 pl-4">
            {tools.slice(hidden).map((t) => (
              <li key={t.id} className="relative text-[12.5px] leading-[18px]">
                <span className={cn("absolute top-[5px] -left-[21px] size-2 rounded-full", t.ok ? "bg-healthy" : "bg-stockout")} aria-hidden />
                <span className="font-mono text-fg-1">{t.toolName}</span>
                <span className="num ml-2 text-[11.5px] text-fg-3">{t.ms ?? 0} ms</span>
                {t.ok ? <span className="sr-only">ok</span> : <span className="ml-2 text-[11.5px] text-stockout">failed</span>}
                <p className="truncate text-fg-2" title={toolResult(t)}>
                  {toolResult(t)}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}

      {every.length > 0 && notable.length < every.length && (
        <button type="button" onClick={() => setAllRows((v) => !v)} className="mx-4 mt-3 text-[12px] text-fg-3 hover:text-fg-1">
          {allRows ? "Show only changes" : `Show all ${every.length} decisions (${every.length - notable.length} kept as they were)`}
        </button>
      )}
      {rows.length > 0 && (
        <div className="mt-3 border-t border-white/[0.06]">
          <table className="w-full table-fixed text-[12.5px]">
            <colgroup>
              <col className="w-[92px]" />
              <col className="w-[148px]" />
              <col />
              <col className="w-[104px]" />
            </colgroup>
            <thead>
              <tr className="text-left">
                {["SKU", "Decision", "Reason", "Guardrail"].map((h) => (
                  <th key={h} className="micro-label h-8 px-3 font-medium first:pl-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-white/[0.05] align-top">
                  <td className="py-2 pr-3 pl-4 font-mono text-fg-1">
                    {r.changed && lineOf.get(r.sku) ? (
                      <Link href={`/procurement/${planId}?line=${lineOf.get(r.sku)}`} className="hover:text-brand hover:underline">
                        {r.sku}
                      </Link>
                    ) : (
                      r.sku
                    )}
                  </td>
                  <td className={cn("px-3 py-2", r.changed ? "text-brand" : "text-fg-1")}>{r.decision}</td>
                  <td className="px-3 py-2 break-words text-fg-2">{r.reason}</td>
                  <td className="py-2 pr-4 pl-3 whitespace-nowrap">
                    {r.accepted ? (
                      <span className="inline-flex items-center gap-1 text-healthy">
                        <CircleCheck className="size-3.5" aria-hidden /> Accepted
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-stockout" title={r.reason}>
                        <CircleX className="size-3.5" aria-hidden /> <span className="font-mono text-[11.5px]">{r.code}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="h-4" />
    </li>
  );
}

/** The run in one line: who does what, and what stays with people. */
function HowItWorks() {
  const steps = ["Demand Agent picks the forecast", "Supplier Agent picks the supplier", "Order Agent creates and sends the POs"];
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-2">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-full bg-brand/15 text-[11px] text-brand">{i + 1}</span>
            {s}
            {i < steps.length - 1 && <span className="text-fg-3">→</span>}
          </li>
        ))}
      </ol>
      <p className="mt-1.5 text-[11.5px] text-fg-3">Every number comes from the engine. The agents choose within guardrails; POs up to the approval limit are then sent automatically (simulated, nothing is emailed) and larger ones wait for the Owner.</p>
    </div>
  );
}

function Results({ run, planId }: { run: RunWithSteps; planId: string }) {
  const changed = [...decisions(run, "demand"), ...decisions(run, "supplier")].filter((d) => d.changed);
  const order = orderResult(run);
  const lineOf = new Map(run.skus.map((s) => [s.sku, s.lineId]));
  if (run.status === "running" && changed.length === 0 && !order) return null;
  return (
    <section className="surface-hero p-5" aria-label="Results">
      <h3 className="text-[15px] leading-[22px] text-fg-1">Results</h3>
      <p className="mt-1 text-[13px] text-fg-2">
        {changed.length} line{changed.length === 1 ? "" : "s"} changed · {order?.created.filter((p) => !p.addedTo).length ?? 0} new purchase order{order?.created.filter((p) => !p.addedTo).length === 1 ? "" : "s"}
        {order && order.created.some((p) => p.addedTo) && ` · lines added to ${order.created.filter((p) => p.addedTo).length} existing`}
        {order && order.created.length > 0 && ` · ${order.created.filter((p) => p.status === "pending_approval").length || "none"} need${order.created.filter((p) => p.status === "pending_approval").length === 1 ? "s" : ""} the Owner`}
      </p>
      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="micro-label mb-2">Lines changed · {changed.length}</p>
          {changed.length === 0 ? (
            <p className="text-[12.5px] text-fg-3">None: every line kept its forecast and supplier.</p>
          ) : (
            <ul className="space-y-1.5">
              {changed.map((c) => (
                <li key={c.key} className="text-[12.5px]">
                  {lineOf.get(c.sku) ? (
                    <Link href={`/procurement/${planId}?line=${lineOf.get(c.sku)}`} className="font-mono text-fg-1 hover:text-brand hover:underline">
                      {c.sku}
                    </Link>
                  ) : (
                    <span className="font-mono text-fg-1">{c.sku}</span>
                  )}
                  <span className="text-fg-2"> · {c.decision}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="micro-label mb-2">Purchase orders · {order?.created.length ?? 0}</p>
          {!order || order.created.length === 0 ? (
            <p className="text-[12.5px] text-fg-3">{run.status === "running" ? "The Order Agent has not finished yet." : "No purchase orders were created."}</p>
          ) : (
            <ul className="space-y-1.5">
              {order.created.map((p) => (
                <li key={p.poId} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <PackageCheck className="size-3.5 text-healthy" aria-hidden />
                  <Link href={`/purchase-orders/${p.poId}`} className="font-mono text-fg-1 hover:text-brand hover:underline">
                    {p.poNumber}
                  </Link>
                  <span className="text-fg-3">
                    {p.supplierCode} · {formatINR(p.grandTotal, { paise: false })}
                  </span>
                  {p.addedTo && <span className="text-[11.5px] text-fg-3">· lines added to this existing PO</span>}
                  {p.status === "sent" && (
                    <span className="inline-flex h-[22px] items-center rounded-full border border-healthy/30 bg-healthy-bg px-2 text-[11.5px] text-healthy">Sent (simulated)</span>
                  )}
                  {p.status === "pending_approval" && (
                    <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-expiry/30 bg-expiry-bg px-2 text-[11.5px] text-expiry">
                      <ShieldAlert className="size-3" aria-hidden /> Owner approval
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {order && order.skipped.length > 0 && (
            <p className="mt-2 text-[12px] text-fg-3">Skipped: {order.skipped.map((s) => `${s.sku} (${s.reason})`).join("; ")}</p>
          )}
        </div>
      </div>
      <p className="mt-4 text-[11.5px] text-fg-3">POs within the approval limit were sent automatically (simulated, nothing was emailed). No AI can approve a PO for the Owner: larger POs wait for the Owner and are sent once approved.</p>
    </section>
  );
}

function PastRuns({ runs, currentId, onSelect }: { runs: AgentRun[]; currentId: string | null; onSelect: (id: string) => void }) {
  if (runs.length === 0) return null;
  return (
    <section aria-label="Past runs" className="pt-1">
      <p className="micro-label mb-2 flex items-center gap-1.5">
        <History className="size-3.5" aria-hidden /> Past runs
      </p>
      <ul className="surface divide-y divide-white/[0.05] overflow-hidden">
        {runs.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.04]", r.id === currentId && "bg-white/[0.05]")}
            >
              <StatusPill status={RUN_PILL[r.status].tone}>{RUN_PILL[r.status].label}</StatusPill>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2" title={r.summary ?? undefined}>
                {r.summary ?? "Running…"}
              </span>
              <span className="shrink-0 text-[11.5px] text-fg-3">{formatDateTime(r.startedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="surface space-y-2 p-4">
          <span className="shimmer block h-5 w-40 rounded-full" />
          <span className="shimmer block h-4 w-72 rounded-full" />
        </div>
      ))}
    </div>
  );
}
