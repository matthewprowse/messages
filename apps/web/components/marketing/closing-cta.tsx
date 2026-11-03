// The last band on most marketing pages: one line on the beta and the Request Access button, centred.

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Heading, Section } from "./section";

export function ClosingCta({ title = "Be One of the First Offices on Konva", lead = "We are taking a small number of offices into the beta and setting each one up with them." }: { title?: string; lead?: string }) {
  return (
    <Section className="flex flex-col items-center gap-8">
      <Heading title={title} lead={lead} center />
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild size="lg"><Link href="/request-access">Request Access</Link></Button>
        <Button asChild size="lg" variant="ghost"><Link href="/pricing">See Pricing</Link></Button>
      </div>
    </Section>
  );
}
