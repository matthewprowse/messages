import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { AppProvider } from "@/lib/store";
import { AuthProvider } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// A toast's action (Undo, Open) as a stock secondary Button at its default h-8 size, on the right of the
// text. Sonner styles its own button with attribute selectors, so these override it with !important.
const ACTION_BUTTON =
  "ml-auto! h-8! rounded-lg! px-2.5! text-sm! font-medium! bg-secondary! text-secondary-foreground! hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]! focus-visible:ring-3! focus-visible:ring-ring/50!";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Messages", template: "%s · Messages" },
  description: "One inbox for email and WhatsApp, with AI triage and drafts in your voice.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Messages" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#121210" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider attribute="class" defaultTheme="light" disableTransitionOnChange>
          <AuthProvider>
            <TooltipProvider delayDuration={300}>
              <AppProvider>
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
