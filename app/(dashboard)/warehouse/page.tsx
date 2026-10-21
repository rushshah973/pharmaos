import type { Metadata } from "next";
import { Boxes } from "lucide-react";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "3D Warehouse" };

export default function Page() {
  return (
    <ComingSoon
      title="3D Warehouse"
      description="Every bin, coloured by stock risk, with proposed stock shown as ghosts."
      icon={Boxes}
      stage={5}
      detail="The interactive 3D and 2D warehouse views arrive with the heatmap and put-away logic."
    />
  );
}
