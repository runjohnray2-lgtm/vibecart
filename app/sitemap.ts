import type { MetadataRoute } from "next"

const base = "https://vibecart.vercel.app"

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/cloud`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/dashboard`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/admin`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/llms.txt`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/agents.md`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
  ]
}
