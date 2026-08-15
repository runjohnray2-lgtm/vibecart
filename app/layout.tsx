import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://vibecart.vercel.app"),
  title: "VibeCart — Commerce infrastructure for AI-built apps",
  description: "Lightweight commerce infrastructure for AI-built apps and agents with trusted server-side pricing, Stripe Checkout, MCP, and UCP catalog discovery.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "VibeCart — Commerce infrastructure for AI-built apps",
    description: "Stripe commerce infrastructure for AI-built apps and agents, with MCP and UCP discovery.",
    url: "/",
    siteName: "VibeCart",
    type: "website",
  },
};

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "VibeCart",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: "https://vibecart.vercel.app",
  codeRepository: "https://github.com/runjohnray2-lgtm/vibecart",
  description:
    "Commerce infrastructure for AI-built apps and AI agents with trusted server-side pricing, Stripe Checkout, MCP, and UCP catalog discovery.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Open core reference implementation. Managed-service pricing is separate and only applies when explicitly published.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
