import type { Metadata } from "next";
import { siteUrl } from "@/lib/site-url";
import { Geist, Geist_Mono, Oswald } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteBackground } from "@/components/layout/site-background";
import { StalenessBanner } from "@/components/layout/staleness-banner";
import { BRAND } from "@/lib/branding";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  // Every relative URL (canonical, og:url, og:image) resolves to the www site.
  metadataBase: new URL(siteUrl()),
  title: {
    default: "The Rat Trap Fantasy Football League | Rat Trap Fantasy",
    template: "%s | Rat Trap Fantasy Football",
  },
  description: BRAND.description,
  applicationName: "Rat Trap Fantasy Football",
  openGraph: { siteName: "Rat Trap Fantasy Football", type: "website", locale: "en_US" },
  // Pages' opengraph-image cards, shown full width on X rather than as a thumbnail.
  twitter: { card: "summary_large_image" },
  /*
   * Default for every page: not indexed, links followed. Allowlisted pages
   * (lib/indexing.ts) override this with index: true; the proxy sends the
   * matching X-Robots-Tag header.
   */
  robots: { index: false, follow: true },
  // Search Console ownership, if the HTML-tag method is used (value from env).
  ...(process.env.GOOGLE_SITE_VERIFICATION ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } } : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} ${oswald.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <SiteBackground />
        <TooltipProvider>
          <SiteHeader />
          <StalenessBanner />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </TooltipProvider>
      </body>
    </html>
  );
}
