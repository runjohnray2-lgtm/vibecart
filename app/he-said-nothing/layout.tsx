import type { Metadata } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://hesaidnothing.com"),
  title: "He Said Nothing | Gifts for Men Who Want Nothing",
  description:
    "A personalized mystery gift box for husbands, boyfriends, dads, sons, brothers, and other hard-to-buy-for men who say they want nothing.",
  keywords: [
    "gifts for men who want nothing",
    "gifts for men who have everything",
    "funny gifts for husband",
    "gift for dad who wants nothing",
    "mystery gift box for men",
  ],
  openGraph: {
    title: "He Said Nothing",
    description: "He said he wanted nothing. So we got him exactly what he asked for.",
    type: "website",
    url: "https://hesaidnothing.com",
  },
  alternates: { canonical: "https://hesaidnothing.com" },
};

export default function HeSaidNothingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
