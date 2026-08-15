import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/admin/"],
    },
    sitemap: "https://vibecart.vercel.app/sitemap.xml",
    host: "https://vibecart.vercel.app",
  }
}
