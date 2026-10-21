import type { LucideIcon } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";

/** Placeholder for a section that a later stage builds. */
export function ComingSoon({
  title,
  description,
  icon,
  stage,
  detail,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  stage: number;
  detail: string;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <EmptyState icon={icon} title={`Coming in stage ${stage}`} description={detail} />
    </div>
  );
}
