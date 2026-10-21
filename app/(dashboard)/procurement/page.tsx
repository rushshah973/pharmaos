import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "Procurement" };

export default function Page() {
  return (
    <ComingSoon
      title="Procurement"
      description="Budget-capped purchase plans, ranked by loss prevented per rupee."
      icon={ClipboardList}
      stage={3}
      detail="Plans you create from the Command Center will be listed here with their budget, total and status."
    />
  );
}
