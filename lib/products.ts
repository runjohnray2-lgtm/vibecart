// Minimal in-memory product catalog for the VibeCart MVP demo.
// A real integration would swap this for a DB call or the merchant's own
// product source — the point of VibeCart is the checkout mechanism, not
// product management.

export interface VibeProduct {
  id: string
  name: string
  description: string
  priceCents: number
  image: string
  variant?: string // e.g. "Size: L", "Color: Black" — optional, purely informational
}

export const PRODUCTS: VibeProduct[] = [
  {
    id: "hsn-nothing-box-39",
    name: "A Little Nothing",
    description: "He Said Nothing mystery gift box — $39 pilot tier. Final contents are selected from the shopper's clues before fulfillment opens.",
    priceCents: 3900,
    image: "",
  },
  {
    id: "hsn-nothing-box-59",
    name: "The Original Nothing Box",
    description: "He Said Nothing mystery gift box — $59 pilot tier. Final contents are selected from the shopper's clues before fulfillment opens.",
    priceCents: 5900,
    image: "",
  },
  {
    id: "hsn-nothing-box-89",
    name: "A Whole Lot of Nothing",
    description: "He Said Nothing mystery gift box — $89 pilot tier. Final contents are selected from the shopper's clues before fulfillment opens.",
    priceCents: 8900,
    image: "",
  },
  {
    id: "sticker-pack-nw",
    name: "Pacific Northwest Sticker Pack",
    description: "5 regional stickers — Bigfoot, raccoon, mermaid, pirate ship, buck.",
    priceCents: 1200,
    image: "https://placehold.co/400x400/1a1a2e/ffffff?text=Sticker+Pack",
  },
  {
    id: "led-plate-frame",
    name: "LED Motorcycle Plate Frame",
    description: "Custom Flex LED array license plate frame.",
    priceCents: 4900,
    image: "https://placehold.co/400x400/16213e/ffffff?text=LED+Frame",
  },
  {
    id: "shirt-custom-dtf",
    name: "Custom DTF Shirt",
    description: "Your design, printed direct-to-film, any size S–3XL.",
    priceCents: 2200,
    image: "https://placehold.co/400x400/0f3460/ffffff?text=Custom+Shirt",
    variant: "Size: L",
  },
]

export function getProduct(id: string): VibeProduct | undefined {
  return PRODUCTS.find(p => p.id === id)
}
