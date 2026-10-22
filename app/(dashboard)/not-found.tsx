import Link from "next/link";
import { SearchX } from "lucide-react";

// A plan, PO or page that does not exist (§10.1 empty state: one line, one action).
export default function NotFound() {
  return (
    <div className="surface mx-auto mt-10 flex max-w-xl flex-col items-center px-6 py-14 text-center">
      <span className="glass-pill flex size-12 items-center justify-center text-brand">
        <SearchX className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <h1 className="mt-4 text-[22px] leading-7 font-light tracking-[-0.02em] text-fg-1">Not found</h1>
      <p className="mt-1 max-w-md text-fg-2">This plan, purchase order or page does not exist, or it was removed when the demo data was reseeded.</p>
      <Link href="/" className="mt-5 inline-flex h-9 items-center rounded-full bg-white px-4 text-[13px] font-medium text-black hover:bg-white/90">
        Back to the Command Center
      </Link>
    </div>
  );
}
