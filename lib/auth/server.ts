import { createNeonAuth } from "@neondatabase/auth/next/server"

function required(name: "NEON_AUTH_BASE_URL" | "NEON_AUTH_COOKIE_SECRET"): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for VibeCart App Factory authentication`)
  return value
}

export const auth = createNeonAuth({
  baseUrl: required("NEON_AUTH_BASE_URL"),
  cookies: {
    secret: required("NEON_AUTH_COOKIE_SECRET"),
  },
})
