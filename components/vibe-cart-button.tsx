"use client"

import { useState } from "react"
import { VibeProduct } from "@/lib/products"

interface VibeCartButtonProps {
  product: VibeProduct
  quantity?: number
  className?: string
  // Opt-in only. When true, the full product object (including price) is
  // sent inline in the request instead of just an ID, so the server doesn't
  // need this product registered in its own catalog. This means the price
  // is coming from the browser and could be edited before the request is
  // sent — fine for prototypes/demos, NOT safe for a real store without
  // your own server-side price validation. Default is false: the safer,
  // catalog-lookup-only path.
  trustClientPrice?: boolean
}

// Drop-in "Buy Now" button. This is the entire integration surface for
// VibeCart: one component, one prop (the product), no cart state to manage
// on the merchant's side. Designed to be the simplest possible thing for an
// AI coding agent to scaffold correctly from a one-line prompt like
// "add a buy button for this product."
export function VibeCartButton({ product, quantity = 1, className, trustClientPrice = false }: VibeCartButtonProps) {
  const [loading, setLoading] = useState(false)
  const [demoMessage, setDemoMessage] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setDemoMessage(null)
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            trustClientPrice
              ? { product, quantity }
              : { productId: product.id, quantity },
          ],
          allowInlineProduct: trustClientPrice,
        }),
      })
      const data = await res.json()
      if (!data.success) {
        setDemoMessage(`Error: ${data.error}`)
        return
      }
      if (data.mode === "demo") {
        setDemoMessage(data.message)
        return
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
      }
    } catch (err) {
      setDemoMessage(`Network error: ${String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className={className ?? "bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm"}
      >
        {loading ? "Loading…" : `Buy $${(product.priceCents / 100).toFixed(2)}`}
      </button>
      {demoMessage && (
        <p className="text-xs text-amber-400 mt-2 max-w-xs">{demoMessage}</p>
      )}
    </div>
  )
}
