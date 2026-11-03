// Pricing: the two plans with what each includes, a full comparison table and the questions people ask about paying.

import type { Metadata } from "next";
import { pageMeta } from "@/components/marketing/page-meta";
import { Check, Minus } from "lucide-react";
import { PRICES } from "@/lib/site";
import { COMPARISON, PRICING_FAQ } from "@/components/marketing/plans";
import { PlanCards } from "@/components/marketing/plan-cards";
import { PageIntro, Section } from "@/components/marketing/section";
import { Faq } from "@/components/marketing/faq";
import { ClosingCta } from "@/components/marketing/closing-cta";
import { JsonLd, breadcrumbData, faqData } from "@/components/marketing/json-ld";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const DESCRIPTION = `Konva costs R${PRICES.individual} a month for one person, or R${PRICES.seat} a seat for offices of ${PRICES.minSeats} or more. Every AI feature on every plan, priced in rand.`;

export const metadata: Metadata = pageMeta({ title: "Pricing", description: DESCRIPTION, path: "/pricing" });

function Mark({ value }: { value: boolean | string }) {
  if (typeof value === "string") return <span className="text-muted-foreground">{value}</span>;
  return value ? <Check className="size-4" aria-label="Included" /> : <Minus className="size-4 text-muted-foreground" aria-label="Not included" />;
}

export default function PricingPage() {
  return (
    <>
      <JsonLd data={[breadcrumbData("Pricing", "/pricing"), faqData(PRICING_FAQ)]} />
      <Section first>
        <PageIntro title="Simple Prices in Rand" lead="Every AI feature is on every plan. Pay for one person or per seat for the whole office, monthly or yearly for about 20% less. Prices exclude VAT." />
        <div className="mt-16"><PlanCards /></div>
      </Section>

      <Section>
        <h2 className="text-center text-3xl font-semibold tracking-tight md:text-4xl">Compare Plans</h2>
        <div className="mx-auto mt-12 max-w-4xl overflow-x-auto">
          <Table className="min-w-[36rem] table-fixed">
            <colgroup><col /><col className="w-32 md:w-48" /><col className="w-32 md:w-48" /></colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-muted-foreground">Feature</TableHead>
                <TableHead>Individual</TableHead>
                <TableHead>Team</TableHead>
              </TableRow>
            </TableHeader>
            {COMPARISON.map((g) => (
              <TableBody key={g.group}>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="pt-8 font-medium">{g.group}</TableCell>
                </TableRow>
                {g.rows.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell className="whitespace-normal text-muted-foreground">{r.label}</TableCell>
                    <TableCell><Mark value={r.individual} /></TableCell>
                    <TableCell><Mark value={r.team} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            ))}
          </Table>
        </div>
      </Section>

      <Section><Faq items={PRICING_FAQ} title="Questions About Pricing" /></Section>
      <ClosingCta />
    </>
  );
}
