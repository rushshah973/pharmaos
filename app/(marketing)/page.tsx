import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

// The public landing page. Static: no database reads, so it is prerendered and loads instantly.
export const metadata: Metadata = {
  title: { absolute: "PharmaOS · Order every medicine before it runs out" },
  description:
    "PharmaOS forecasts demand for every SKU, builds a ranked purchase plan in seconds, lets three AI agents review it, and sends one purchase order per supplier, with the Owner in control of large orders.",
  openGraph: {
    title: "PharmaOS · AI procurement co-pilot for pharma stockists",
    description: "Forecast, plan, approve and receive: order every medicine before it runs out.",
    type: "website",
  },
};

export default function HomePage() {
  return <Landing />;
}
