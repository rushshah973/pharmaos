"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Error state (§10.1): what happened, what to do, Retry (re-runs the server components). */
export function ErrorState({ title, description }: { title: string; description: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div role="alert" className="surface flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-stockout-bg text-stockout ring-1 ring-stockout/20">
        <TriangleAlert className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <h2 className="mt-4 text-[17px] leading-[24px] font-normal tracking-[-0.015em] text-fg-1">{title}</h2>
      <p className="mt-1 max-w-md text-fg-2">{description}</p>
      <Button variant="outline" className="mt-5 h-9 px-4" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        <RotateCw className={pending ? "size-4 animate-spin" : "size-4"} strokeWidth={1.75} aria-hidden />
        Retry
      </Button>
    </div>
  );
}
