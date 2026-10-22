import Link from "next/link";
import { ArrowRight, Check, ClipboardList, FileCheck2, LineChart, PackageCheck, type LucideIcon } from "lucide-react";
import { cn } from "cn";

// The product in four steps, the same on every screen: forecast → plan → approve & send → receive.
// WorkflowRail is the large version on the Today page; WorkflowStepper is the compact one on the other screens.

export type StepId = 1 | 2 | 3 | 4;

export const STEPS: { id: StepId; title: string; short: string; icon: LucideIcon; href: string }[] = [
  { id: 1, title: "Forecast demand", short: "Forecast", icon: LineChart, href: "/data" },
  { id: 2, title: "Plan reorders", short: "Plan", icon: ClipboardList, href: "/procurement" },
  { id: 3, title: "Approve & send", short: "Approve & send", icon: FileCheck2, href: "/purchase-orders" },
  { id: 4, title: "Receive stock", short: "Receive", icon: PackageCheck, href: "/purchase-orders?filter=sent" },
];

export type RailStep = {
  id: StepId;
  /** The one figure for this step, e.g. "625", and its unit ("packs/day"), drawn smaller beside it. */
  value: string;
  unit?: string;
  /** One line under the figure. */
  note: string;
  /** The step's action; only the current step shows it as a button. */
  action?: { label: string; href: string };
};

type State = "done" | "current" | "next";
const stateOf = (id: StepId, current: StepId | 0): State => (current === 0 || id < current ? "done" : id === current ? "current" : "next");

/** The four steps as connected cards: done steps get a check, the current one glows and carries the action. */
export function WorkflowRail({ steps, current }: { steps: RailStep[]; current: StepId | 0 }) {
  return (
    <ol className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1" aria-label="Today's workflow">
      {steps.map((s, i) => {
        const def = STEPS[s.id - 1];
        const state = stateOf(s.id, current);
        const Icon = def.icon;
        return (
          <li key={s.id} className="relative" aria-current={state === "current" ? "step" : undefined}>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-[38px] -right-3 z-10 h-px w-3 max-lg:hidden",
                  state === "done" ? "bg-brand/60" : "bg-white/15",
                )}
              />
            )}
            <div
              className={cn(
                "flex h-full flex-col p-5 transition-colors",
                state === "current" ? "surface-warm ring-1 ring-brand/30" : "surface",
                state === "next" && "opacity-80",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-medium",
                    state === "done" && "bg-healthy/15 text-healthy ring-1 ring-healthy/30",
                    state === "current" && "bg-brand text-black shadow-[0_0_24px_rgba(255,141,77,0.55)]",
                    state === "next" && "bg-white/[0.06] text-fg-2 ring-1 ring-white/10",
                  )}
                >
                  {state === "done" ? <Check className="size-4" strokeWidth={2.25} aria-hidden /> : s.id}
                </span>
                <div className="min-w-0">
                  <p className="micro-label">Step {s.id}</p>
                  <h3 className="flex items-center gap-1.5 text-[15px] leading-5 text-fg-1">
                    <Icon className="size-4 shrink-0 text-fg-3" strokeWidth={1.6} aria-hidden />
                    {def.title}
                  </h3>
                </div>
              </div>
              <p className={cn("display mt-5 text-[30px] leading-9 whitespace-nowrap max-xl:text-[26px]", state === "current" ? "text-white" : "text-fg-1")}>
                {s.value}
                {s.unit && <span className="ml-1.5 text-[14px] tracking-normal text-fg-3">{s.unit}</span>}
              </p>
              <p className={cn("mt-1 text-[12.5px] leading-[18px]", state === "current" ? "text-white/70" : "text-fg-3")}>{s.note}</p>
              <div className="mt-auto pt-5">
                {s.action ? (
                  state === "current" ? (
                    <Link
                      href={s.action.href}
                      className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-black transition-colors hover:bg-white/90"
                    >
                      {s.action.label}
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  ) : (
                    <Link href={s.action.href} className="inline-flex items-center gap-1 text-[12.5px] text-fg-2 transition-colors hover:text-fg-1">
                      {s.action.label}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  )
                ) : (
                  <span className="text-[12.5px] text-fg-3">{state === "done" ? "Done" : "Later today"}</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Where this screen sits in the workflow: four linked steps in a glass pill, the current one highlighted. */
export function WorkflowStepper({ current, className }: { current: StepId; className?: string }) {
  return (
    <nav aria-label="Workflow" className={cn("glass-pill inline-flex max-w-full items-center gap-0.5 overflow-x-auto p-1", className)}>
      {STEPS.map((s, i) => {
        const state = stateOf(s.id, current);
        return (
          <span key={s.id} className="flex items-center">
            <Link
              href={s.href}
              prefetch={false}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex h-8 items-center gap-2 rounded-full px-3 text-[12.5px] whitespace-nowrap transition-colors",
                state === "current" ? "bg-brand/15 text-fg-1 ring-1 ring-brand/40" : "text-fg-2 hover:bg-white/[0.05] hover:text-fg-1",
              )}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[11px]",
                  state === "done" && "bg-healthy/15 text-healthy",
                  state === "current" && "bg-brand text-black",
                  state === "next" && "bg-white/[0.07] text-fg-3",
                )}
              >
                {state === "done" ? <Check className="size-3" strokeWidth={2.5} aria-hidden /> : s.id}
              </span>
              {s.short}
            </Link>
            {i < STEPS.length - 1 && <span aria-hidden className="mx-0.5 h-px w-3 bg-white/15" />}
          </span>
        );
      })}
    </nav>
  );
}
