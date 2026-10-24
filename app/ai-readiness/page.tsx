import type { Metadata } from "next"
import { AiReadinessDashboard } from "@/components/ai-readiness-dashboard"

export const metadata: Metadata = {
  title: "AI Readiness check (manual, offline) | VibeCart",
  description: "Manual, offline diagnostic for a pasted product catalog. Not connected to a store. No ranking or recommendation is predicted.",
  robots: { index: false, follow: false },
}

export default function AiReadinessPage() {
  return <AiReadinessDashboard />
}
