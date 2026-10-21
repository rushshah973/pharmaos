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
      <span className="flex size-10 items-center justify-center rounded-full bg-brand-glow text-brand ring-1 ring-brand/20">
        <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <h2 className="mt-4 text-[15px] leading-[22px] font-semibold text-fg-1">{title}</h2>
      <p className="mt-1 max-w-md text-fg-2">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
