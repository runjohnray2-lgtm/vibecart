export type StripeKeyMode = "live" | "test" | "unknown"

/** Classifies a Stripe secret/restricted key by prefix only. Never returns or logs the key. */
export function stripeKeyMode(value: string | null | undefined): StripeKeyMode {
  const key = value?.trim() ?? ""
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live"
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test"
  return "unknown"
}
