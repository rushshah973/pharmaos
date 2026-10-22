import { cn } from "cn";

/** Logo mark: five diagonal strokes (a stack of strips) fading from white to copper. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id="pharmaos-mark" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#34D36E" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => {
        // Strips get shorter towards the corners, like a hatched tile.
        const x = 4 + i * 5;
        const inset = Math.abs(i - 2) * 3;
        return <path key={i} d={`M${x + inset * 0.5} ${27 - inset}L${x + 10 - inset * 0.5} ${5 + inset}`} stroke="url(#pharmaos-mark)" strokeWidth="2.6" strokeLinecap="round" />;
      })}
    </svg>
  );
}

export function Logo({ wordmarkClassName }: { wordmarkClassName?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={30} />
      <span className={cn("text-[16px] font-medium tracking-[-0.02em] text-fg-1", wordmarkClassName)}>PharmaOS</span>
    </span>
  );
}
