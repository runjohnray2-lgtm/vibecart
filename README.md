# VibeCart

The lightest embeddable shopping cart for vibe-coded (AI-built) websites.
One component, one API route, no cart-state management, no platform fee —
payments go straight to your own Stripe account.

## Why this exists

Every existing "add commerce to any site" tool (Shopify Buy Button, Snipcart,
Medusa) was built for human developers reading docs. VibeCart is designed
for AI coding agents scaffolding a checkout flow from a one-line prompt —
minimal surface area, one obvious integration path, no config sprawl.

## Quick start

1. `npm install` then `npm run dev`
2. Visit `/` — three demo products render in **demo mode** (no real charges)
   until you set a Stripe key.
3. Add `STRIPE_SECRET_KEY` (your own Stripe secret key, test or live) as an
   environment variable to go live. Never commit it or paste it in chat —
   add it directly in your hosting provider's dashboard.

## Integration

```tsx
import { VibeCartButton } from "@/components/vibe-cart-button"

<VibeCartButton
  product={{
    id: "my-product",
    name: "My Product",
    description: "...",
    priceCents: 1999,
    image: "/my-product.png",
  }}
/>
```

See `/llms.txt` for the full machine-readable integration spec (the file AI
coding agents read to implement this correctly in one shot).

## What's NOT built yet (known gaps, not hidden)

- No admin dashboard or inventory management
- No tax calculation or multi-currency support
- No multi-item cart UI (each button checks out its own item independently;
  Stripe Checkout supports multiple line items server-side, but the demo
  doesn't yet expose a "cart with several different products" UI)
- Product catalog is a static in-memory array, not a database

## License

MIT-style — free to use and adapt.
