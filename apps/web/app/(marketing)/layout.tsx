// The public marketing site's frame: header, page, footer. The AppShell lets these pages through without a session
// (lib/marketing-routes.ts), and unlike the app they are open to search engines.

import type { Metadata } from "next";
import "./marketing.css";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";

// Each page sets its own title, description and link preview (page-meta.ts).
export const metadata: Metadata = { robots: { index: true, follow: true } };

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <main id="content" className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
