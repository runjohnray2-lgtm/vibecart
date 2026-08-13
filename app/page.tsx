import { PRODUCTS } from "@/lib/products"
import { VibeCartButton } from "@/components/vibe-cart-button"

export default function Home() {
  const hasStripeKey = !!process.env.STRIPE_SECRET_KEY

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">🛍️ VibeCart</h1>
          <p className="text-neutral-400">
            A one-file Stripe Checkout button for vibe-coded sites — not a full shopping
            cart. Drop it in, sell one product per button, no cart state, no admin panel.
            If you need a real multi-item cart with inventory, use Shopify Buy Button,
            Snipcart, or Medusa instead.
          </p>
        </header>

        {!hasStripeKey && (
          <div className="bg-amber-500/10 border border-amber-600/40 rounded-xl px-4 py-3 text-sm text-amber-300">
            🧪 <strong>Demo mode</strong> — no Stripe key configured. Buy buttons below simulate
            checkout instead of charging a real card. Add <code>STRIPE_SECRET_KEY</code> in your
            hosting provider&apos;s environment variables to go live.
          </div>
        )}

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PRODUCTS.map(product => (
            <div key={product.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 space-y-3">
              <img src={product.image} alt={product.name} className="w-full rounded-lg" />
              <div>
                <h3 className="font-semibold text-sm">{product.name}</h3>
                <p className="text-xs text-neutral-500 mt-1">{product.description}</p>
              </div>
              <VibeCartButton product={product} showQuantityStepper={product.id === "shirt-custom-dtf"} />
            </div>
          ))}
        </section>

        <section className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-sm">Integration — the entire thing</h2>
          <pre className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 text-xs overflow-x-auto text-neutral-300">
{String.raw`// components/vibe-cart-button usage
<VibeCartButton product={{
  id: "my-product",
  name: "My Product",
  description: "...",
  priceCents: 1999,
  image: "https://example.com/my-product.png",
}} />`}
          </pre>
          <p className="text-xs text-neutral-500">
            No cart context, no state management, no checkout page to build — the button
            posts to <code>/api/checkout</code>, which creates a Stripe Checkout session and
            redirects. Each button checks out its own single item — this is a Checkout
            button, not a shared multi-item cart. See{" "}
            <a href="/llms.txt" className="underline text-emerald-400">/llms.txt</a> for
            the full machine-readable spec, including the complete source code.
          </p>
        </section>

        <footer className="text-xs text-neutral-600 text-center pt-4">
          VibeCart is an MVP. Payments run through your own Stripe account — you keep 100% of
          revenue minus Stripe&apos;s standard processing fees. No platform cut.
        </footer>
      </div>
    </main>
  )
}
