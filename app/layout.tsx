import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VibeCart — Stripe Checkout for AI-built apps",
  description: "A lightweight Stripe Checkout primitive for AI-built and vibe-coded apps: one component, one API route, and trusted server-side pricing.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
