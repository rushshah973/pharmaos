import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "Purchase Orders" };

export default function Page() {
  return (
    <ComingSoon
      title="Purchase Orders"
      description="Draft purchase orders generated from approved plan lines, one per supplier."
      icon={FileText}
      stage={4}
      detail="Approving plan lines will create draft POs here, ready to print or export as CSV."
    />
  );
}
