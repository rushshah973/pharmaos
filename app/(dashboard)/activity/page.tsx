import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "Activity Log" };

export default function Page() {
  return (
    <ComingSoon
      title="Activity Log"
      description="An append-only record of every plan, edit, approval and agent action."
      icon={Activity}
      stage={4}
      detail="Each change will be listed with who made it, what changed and why."
    />
  );
}
