import type { Metadata, Viewport } from "next";
import { Public_Sans } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={publicSans.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
