"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

// Last-resort error screen for anything a page's own error state did not catch (§10.1: what happened, what to
// do, Retry). Pages and data sections still show their own ErrorState first.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);
  return (
    <div role="alert" className="surface mx-auto mt-10 flex max-w-xl flex-col items-center px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-stockout-bg text-stockout ring-1 ring-stockout/20">
        <TriangleAlert className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <h1 className="mt-4 text-[22px] leading-7 font-light tracking-[-0.02em] text-fg-1">This screen could not load</h1>
      <p className="mt-1 max-w-md text-fg-2">Something went wrong while reading the data, usually the database connection. Try again; if it keeps failing, check the connection.</p>
      <Button variant="outline" className="mt-5 h-9 px-4" onClick={reset}>
        <RotateCw className="size-4" strokeWidth={1.75} aria-hidden />
        Retry
      </Button>
    </div>
  );
}
