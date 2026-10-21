import { cn } from "cn";

/** Logo mark (§10.1 Brand): teal gradient rounded square with a capsule crossed by a check. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id="pharmaos-mark" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2DD4BF" />
          <stop offset="1" stopColor="#0EA5A4" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#pharmaos-mark)" />
      <rect
        x="4.6"
        y="9.2"
        width="14.8"
        height="5.6"
        rx="2.8"
        transform="rotate(-40 12 12)"
        stroke="white"
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      <path d="M8.2 12.3l2.5 2.5 5.1-5.3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ wordmarkClassName }: { wordmarkClassName?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={26} />
      <span className={cn("text-[15px] font-semibold tracking-[-0.01em] text-fg-1", wordmarkClassName)}>PharmaOS</span>
    </span>
  );
}
