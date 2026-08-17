/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "placehold.co" }],
  },
};

if (process.env.VERCEL) {
  console.log(`[vibecart config] durable cart database: ${process.env.DATABASE_URL || process.env.POSTGRES_URL ? "configured" : "missing"}`);
}

module.exports = nextConfig;