// A page of nothing but the setup dialog, on the secondary background. Mock data for now.

import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding/flow";

export const metadata: Metadata = { title: "Welcome" };

export default function OnboardingPage() {
  return (
    <div className="h-dvh w-full bg-secondary">
      <OnboardingFlow />
    </div>
  );
}
