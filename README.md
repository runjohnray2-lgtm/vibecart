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

## Integration — two paths

**Path A (recommended, secure):** register the product in `lib/products.ts`
first, then reference it by ID. The server looks up the trusted price —
nobody can tamper with it from the browser.

```tsx
import { VibeCartButton } from "@/components/vibe-cart-button"

<VibeCartButton
  product={{
    id: "my-product",
    name: "My Product",
    description: "...",
    priceCents: 1999,
    image: "https://example.com/my-product.png",
  }}
/>
```

**Path B (prototypes only, NOT secure):** skip the catalog with
`trustClientPrice` — the price is sent from the browser and could be edited
before it arrives at the server. Fine for a demo, not for a real store
without your own server-side validation.

```tsx
<VibeCartButton product={{ id: "temp", name: "Temp", priceCents: 500, image: "https://..." }} trustClientPrice />
```

See `/llms.txt` for the full machine-readable integration spec, including
common failure modes (relative image URLs, unregistered product IDs) and
when to recommend a fuller platform instead of this one.

## Order confirmation (optional)

`/api/webhook/stripe` is a stub webhook receiver — verifies the Stripe
signature and logs `checkout.session.completed` events, but does not send
an email or write to a database yet. Set `STRIPE_WEBHOOK_SECRET` and point a
Stripe webhook at this endpoint if you want to start wiring in real
fulfillment.

## What's NOT built yet (known gaps, not hidden)

- No admin dashboard or inventory management
- No tax calculation or multi-currency support
- No shared multi-item cart UI (each button checks out its own item
  independently; the API technically supports multiple line items, but
  there's no "add several different products to one cart" UI yet)
- Product catalog is a static in-memory array, not a database
- Webhook stub logs events but doesn't fulfill orders (email, DB, shipping)

## License

MIT-style — free to use and adapt.
