import type { Metadata, Viewport } from "next";
import { Public_Sans } from "next/font/google";
import { ThemeSync } from "@/components/ThemeSync";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { THEME_INIT_SCRIPT } from "@/lib/ui/theme";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kyna Ops",
  description: "Daily failed deliveries, buyer returns and warehouse scanning.",
  applicationName: "Kyna Ops",
  appleWebApp: {
    capable: true,
    // Dark status-bar text over the white header. "black-translucent" would
    // turn the clock white and lose it against the light UI.
    statusBarStyle: "default",
    title: "Kyna Ops",
  },
  formatDetection: { telephone: false },
  // Next 15 only writes `mobile-web-app-capable`; older iOS still reads this.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={publicSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <ThemeSync />
        {children}
        <UpdatePrompt />
      </body>
    </html>
  );
}
