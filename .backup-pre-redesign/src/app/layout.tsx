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
  title: "Kyna Ops — Daily Returns Tracker",
  description:
    "Mobile-first daily returns and failed delivery tracker for Shopee and TikTok Shop.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Kyna Ops",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={publicSans.variable}>
      <body className="antialiased selection:bg-teal-100 selection:text-teal-950">
        {children}
      </body>
    </html>
  );
}
