import { type StepId, WorkflowStepper } from "@/components/workflow/WorkflowSteps";

export function PageHeader({
  title,
  description,
  action,
  step,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Where this screen sits in the forecast → plan → approve & send → receive workflow. */
  step?: StepId;
}) {
  return (
    <div className="space-y-4">
      {step && <WorkflowStepper current={step} />}
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="text-[44px] leading-[48px] font-light tracking-[-0.045em] whitespace-nowrap text-fg-1 max-lg:text-[34px] max-lg:leading-[40px]">{title}</h1>
          {description && <div className="max-w-2xl text-[14px] text-fg-2">{description}</div>}
        </div>
        {action && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{action}</div>}
      </div>
    </div>
  );
}
