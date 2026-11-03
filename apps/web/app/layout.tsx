// Root layout: fonts, metadata and viewport, with the theme, auth and app providers and the AppShell around every page.

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { AppProvider } from "@/lib/store";
import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { AnalyticsTracker } from "@/components/analytics-tracker";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// A toast's action (Undo, Open) as a stock secondary Button at its default h-8 size, on the right of the
// text. Sonner styles its own button with attribute selectors, so these override it with !important.
const ACTION_BUTTON =
  "ml-auto! h-8! rounded-lg! px-2.5! text-sm! font-medium! bg-secondary! text-secondary-foreground! hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]! focus-visible:ring-3! focus-visible:ring-ring/50!";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: "Konva", template: "%s · Konva" },
  description: "One inbox for email and WhatsApp, with AI triage and drafts in your voice.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Konva" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
};

// iPhone and iPad Safari zoom the page when a field under 16px takes focus. maximumScale: 1 stops that, and iOS still
// lets you pinch zoom, so fields can be 14px like the rest of the app. Android honours maximumScale as a zoom lock,
// so it is only sent to iOS.
const IOS_UA = /iPhone|iPad|iPod/;

export async function generateViewport(): Promise<Viewport> {
  const ua = (await headers()).get("user-agent") ?? "";
  return {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
      { media: "(prefers-color-scheme: dark)", color: "#121210" },
    ],
    width: "device-width",
    initialScale: 1,
    ...(IOS_UA.test(ua) ? { maximumScale: 1 } : {}),
    viewportFit: "cover",
    interactiveWidget: "resizes-content",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The per-request nonce from middleware.ts: next-themes' inline script needs it, and reading it renders pages per request. Soft navigations skip the middleware, so it can be missing there; the layout does not re-render then.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider nonce={nonce} attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AuthProvider>
            <TooltipProvider delayDuration={100}>
              <AppProvider>
                <AnalyticsTracker />
                <AppShell>{children}</AppShell>
              </AppProvider>
            </TooltipProvider>
          </AuthProvider>
          {/* 12px from the bottom, exactly 40px tall, one line of text, hugging its content up to Sonner's default 356px width. */}
          <Toaster className="toaster group max-[600px]:w-auto!" position="bottom-center" offset={12} mobileOffset={12} toastOptions={{ classNames: { toast: "cn-toast inset-x-0! mx-auto! w-fit! max-w-(--width) h-10! py-0! has-[[data-button]]:h-12! has-[[data-button]]:gap-6! has-[[data-button]]:pr-2!", content: "min-w-0", title: "truncate", actionButton: ACTION_BUTTON } }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
