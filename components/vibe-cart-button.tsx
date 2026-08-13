"use client"

import { useState } from "react"
import { VibeProduct } from "@/lib/products"

interface VibeCartButtonProps {
  product: VibeProduct
  quantity?: number
  className?: string
  // Show a +/- quantity stepper before the buy button. Off by default to
  // keep the simplest case (one button, one item) truly one line.
  showQuantityStepper?: boolean
  // Opt-in only. When true, the full product object (including price) is
  // sent inline in the request instead of just an ID, so the server doesn't
  // need this product registered in its own catalog. This means the price
  // is coming from the browser and could be edited before the request is
  // sent — fine for prototypes/demos, NOT safe for a real store without
  // your own server-side price validation. Default is false: the safer,
  // catalog-lookup-only path.
  trustClientPrice?: boolean
}

// Drop-in Stripe Checkout button for a single product. This is the entire
// integration surface for VibeCart: one component, one prop (the product),
// no shared cart state to manage on the merchant's side. It is intentionally
// NOT a multi-product shopping cart — each button checks out its own item
// independently. Designed to be the simplest possible thing for an AI
// coding agent to scaffold correctly from a one-line prompt like
// "add a buy button for this product."
export function VibeCartButton({
  product,
  quantity: initialQuantity = 1,
  className,
  showQuantityStepper = false,
  trustClientPrice = false,
}: VibeCartButtonProps) {
  const [quantity, setQuantity] = useState(initialQuantity)
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
      {product.variant && (
        <p className="text-xs text-neutral-500 mb-1">{product.variant}</p>
      )}
      <div className="flex items-center gap-2">
        {showQuantityStepper && (
          <div className="flex items-center border border-neutral-700 rounded-lg">
            <button
              type="button"
              onClick={() => setQuantity(q => Math.max(1, q - 1))}
              className="px-2 py-1 text-neutral-300 hover:text-white"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="px-2 text-sm text-neutral-200">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity(q => q + 1)}
              className="px-2 py-1 text-neutral-300 hover:text-white"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        )}
        <button
          onClick={handleClick}
          disabled={loading}
          className={className ?? "bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm"}
        >
          {loading ? "Loading…" : `Buy $${((product.priceCents * quantity) / 100).toFixed(2)}`}
        </button>
      </div>
      {demoMessage && (
        <p className="text-xs text-amber-400 mt-2 max-w-xs">{demoMessage}</p>
      )}
    </div>
  )
}
