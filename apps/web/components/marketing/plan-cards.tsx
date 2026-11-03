"use client";

// The two plan cards with a Monthly or Yearly switch above them: price, who it is for, the button and what each
// includes. Team is the plan for offices, so it stands forward. Home and Pricing both show them.

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { PLANS } from "./plans";

type Billing = "monthly" | "yearly";

// Thousands with a comma, as in the rest of the site's copy ("R18,500"), not en-ZA's space.
const rand = (n: number) => `R${n.toLocaleString("en-US")}`;

export function PlanCards() {
  const [billing, setBilling] = useState<Billing>("monthly");
  return (
    <div className="flex flex-col items-center gap-10">
      <Tabs value={billing} onValueChange={(v) => setBilling(v as Billing)}>
        <TabsList>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="yearly">Yearly<Badge variant="secondary" className="ml-1.5">Save 20%</Badge></TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid w-full max-w-4xl gap-4 md:grid-cols-2">
        {PLANS.map((p) => {
          const team = p.name === "Team";
          const price = p.price[billing];
          return (
            <div key={p.name} className={cn("flex flex-col gap-8 rounded-2xl border p-6 md:p-8", team ? "bg-background shadow-lg shadow-foreground/5 ring-1 ring-foreground/10" : "bg-muted/30")}>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-medium">{p.name}</h3>
                  {team && <Badge>For Offices</Badge>}
                </div>
                <p className="min-h-10 text-sm text-muted-foreground">{p.blurb}</p>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span key={price} className="text-5xl font-semibold tracking-tight tabular-nums animate-in fade-in-0 slide-in-from-bottom-1 duration-300">{rand(price)}</span>
                  <span className="text-sm text-muted-foreground">{p.per}</span>
                </p>
                <p className="h-5 text-xs text-muted-foreground">{billing === "yearly" ? `${rand(price * 12)}${team ? " a seat" : ""}, billed yearly` : "Billed monthly, cancel any time"}</p>
              </div>
              <Button asChild variant={team ? "default" : "secondary"} size="lg"><Link href="/request-access">Request Access</Link></Button>
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">{p.includesTitle}</p>
                <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
                  {p.includes.map((line) => <li key={line} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />{line}</li>)}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
