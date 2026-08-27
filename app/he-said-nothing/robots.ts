import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/he-said-nothing/admin", "/api/"],
    },
    sitemap: "https://hesaidnothing.com/sitemap.xml",
    host: "https://hesaidnothing.com",
  }
}
