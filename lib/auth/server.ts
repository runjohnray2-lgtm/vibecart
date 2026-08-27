import { createHash } from "node:crypto"
import { createNeonAuth } from "@neondatabase/auth/next/server"

const PRODUCTION_NEON_AUTH_URL = "https://ep-square-tree-avu2wij9.neonauth.c-11.us-east-1.aws.neon.tech/neondb/auth"

type NeonAuth = ReturnType<typeof createNeonAuth>
let authInstance: NeonAuth | null = null

function databaseSecretMaterial(): string {
  const value = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  if (!value) throw new Error("Database configuration is required for VibeCart App Factory authentication")
  return value
}

function cookieSecret(): string {
  const configured = process.env.NEON_AUTH_COOKIE_SECRET?.trim()
  if (configured) return configured
  return createHash("sha256")
    .update("vibecart-neon-auth-cookie-v1\0", "utf8")
    .update(databaseSecretMaterial(), "utf8")
    .digest("base64url")
}

export function getAuth(): NeonAuth {
  if (!authInstance) {
    authInstance = createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL?.trim() || PRODUCTION_NEON_AUTH_URL,
      cookies: {
        secret: cookieSecret(),
      },
    })
  }
  return authInstance
}
