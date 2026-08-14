import { NextResponse } from "next/server"
import Stripe from "stripe"
import { listActiveSubscriptions } from "@/lib/vibe-billing"

export const runtime = "nodejs"

// ============================================================================
// SECURITY-CRITICAL: gate this route behind your own admin-only auth check.
// ============================================================================
// This route returns every customer's email and billing status — sensitive
// data. VibeCart has no concept of "admin" or roles; that access control is
// entirely your app's responsibility. Replace this stub before deploying.
//
// Real example (NextAuth, checking a role/email allowlist):
//
//   import { auth } from "@/auth"
//   const ADMIN_EMAILS = new Set(["you@yourcompany.com"])
//
//   async function isCurrentUserAdmin(): Promise<boolean> {
//     const session = await auth()
//     return !!session?.user?.email && ADMIN_EMAILS.has(session.user.email)
//   }
//
async function isCurrentUserAdmin(): Promise<boolean> {
  // Stub — replace with a real admin check before deploying. Returning
  // false here means this route fails closed instead of silently exposing
  // every customer's billing data to any visitor.
  return false
}

export async function GET() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json(
      { success: false, error: "STRIPE_SECRET_KEY not configured" },
      { status: 501 }
    )
  }

  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Not authorized. Replace isCurrentUserAdmin() in this file with your own admin check — see the comment above it.",
      },
      { status: 403 }
    )
  }

  const stripe = new Stripe(secretKey)
  try {
    const subscribers = await listActiveSubscriptions(stripe)
    return NextResponse.json({ success: true, subscribers })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
