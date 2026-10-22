import type { LucideIcon } from "lucide-react";

/** Designed empty state (§10.1): soft-circle icon, one line of explanation, optional action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="surface flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="glass-pill flex size-12 items-center justify-center text-brand">
        <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <h2 className="mt-4 text-[17px] leading-[24px] font-normal tracking-[-0.015em] text-fg-1">{title}</h2>
      <p className="mt-1 max-w-md text-fg-2">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
