import Stripe from "stripe"

export const dynamic = "force-dynamic"

export default async function CheckoutProbePage() {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  const result: Record<string, unknown> = {
    credentialPresent: Boolean(key),
    credentialPrefixClass: key?.startsWith("sk_")
      ? "secret"
      : key?.startsWith("rk_")
        ? "restricted"
        : "unknown",
  }

  if (!key) {
    return <main style={{ padding: 32, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</main>
  }

  try {
    const stripe = new Stripe(key)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: 100,
          product_data: {
            name: "VibeCart checkout permission probe",
            description: "Temporary diagnostic session. Do not pay.",
          },
        },
        quantity: 1,
      }],
      success_url: "https://vibecart.vercel.app/?probe=success",
      cancel_url: "https://vibecart.vercel.app/?probe=cancelled",
    })

    result.createSucceeded = true
    result.sessionId = session.id
    result.checkoutUrlCreated = Boolean(session.url)

    try {
      await stripe.checkout.sessions.expire(session.id)
      result.expired = true
    } catch (error) {
      result.expired = false
      result.expireError = error instanceof Error ? error.message : "expire failed"
    }
  } catch (error) {
    result.createSucceeded = false
    if (error instanceof Error) {
      result.errorName = error.name
      result.errorMessage = error.message
    }
    if (error && typeof error === "object") {
      const record = error as Record<string, unknown>
      for (const key of ["type", "code", "statusCode", "requestId"]) {
        if (record[key] !== undefined) result[key] = record[key]
      }
      const raw = record.raw
      if (raw && typeof raw === "object") {
        const rawRecord = raw as Record<string, unknown>
        if (rawRecord.type !== undefined) result.rawType = rawRecord.type
        if (rawRecord.code !== undefined) result.rawCode = rawRecord.code
        if (rawRecord.message !== undefined) result.rawMessage = rawRecord.message
      }
    }
  }

  return (
    <main style={{ padding: 32, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
      {JSON.stringify(result, null, 2)}
    </main>
  )
}
