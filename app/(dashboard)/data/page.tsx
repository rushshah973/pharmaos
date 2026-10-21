import type { Metadata } from "next";
import { Database } from "lucide-react";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "Data & Scenarios" };

export default function Page() {
  return (
    <ComingSoon
      title="Data & Scenarios"
      description="Where the demo data comes from, and what-if scenarios to stress the plan."
      icon={Database}
      stage={7}
      detail="Data summary, reference sources, scenario runs and the ROI model arrive in the scenarios stage."
    />
  );
}
