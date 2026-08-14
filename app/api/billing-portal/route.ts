import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createBillingPortalSession } from "@/lib/vibe-billing"

export const runtime = "nodejs"

// ============================================================================
// SECURITY-CRITICAL: replace this stub with your own auth lookup.
// ============================================================================
// This function MUST resolve the Stripe customer ID for the CURRENTLY
// AUTHENTICATED user from YOUR OWN session/auth system (NextAuth, Clerk,
// Lucia, a custom JWT, whatever you're using) — never from a value the
// client sends in the request body. If you accept a client-supplied
// customerId here, any logged-in user could open ANY OTHER customer's
// billing portal by guessing or intercepting their Stripe customer ID.
//
// Real example (NextAuth + Prisma, matching the pattern this was modeled on):
//
//   import { auth } from "@/auth"
//   import { prisma } from "@/lib/db"
//
//   async function getCurrentUserStripeCustomerId(): Promise<string | null> {
//     const session = await auth()
//     if (!session?.user?.id) return null
//     const sub = await prisma.subscription.findUnique({
//       where: { userId: session.user.id },
//       select: { stripeCustomerId: true },
//     })
//     return sub?.stripeCustomerId ?? null
//   }
//
async function getCurrentUserStripeCustomerId(): Promise<string | null> {
  // Stub — replace with real auth lookup before deploying. Returning null
  // here means the route below fails closed with a clear error instead of
  // silently trusting client input.
  return null
}

export async function POST(req: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json(
      { success: false, error: "STRIPE_SECRET_KEY not configured" },
      { status: 501 }
    )
  }

  const stripeCustomerId = await getCurrentUserStripeCustomerId()
  if (!stripeCustomerId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "No authenticated Stripe customer found. Replace getCurrentUserStripeCustomerId() in this file with your own auth/session lookup — see the comment above it.",
      },
      { status: 401 }
    )
  }

  const stripe = new Stripe(secretKey)
  const origin = req.headers.get("origin") ?? new URL(req.url).origin

  try {
    const url = await createBillingPortalSession(stripe, stripeCustomerId, `${origin}/dashboard`)
    return NextResponse.json({ success: true, url })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
