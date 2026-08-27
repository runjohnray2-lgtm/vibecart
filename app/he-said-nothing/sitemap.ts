import type { MetadataRoute } from "next"

const base = "https://hesaidnothing.com"

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/he-said-nothing/policies`, changeFrequency: "monthly", priority: 0.4 },
  ]
}
