"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Check,
  Gift,
  Heart,
  Package,
  Sparkles,
  WandSparkles,
} from "lucide-react";

const boxes = [
  {
    name: "A Little Nothing",
    price: 39,
    subtitle: "A smart, funny gift when you need a win without overthinking it.",
    items: ["Signature NOTHING item", "2–3 useful/fun surprises", "Gift note"],
  },
  {
    name: "The Original Nothing Box",
    price: 59,
    featured: true,
    subtitle: "The main event. Personalized enough to feel picked, mysterious enough to stay fun.",
    items: ["Signature NOTHING item", "1 hero item", "3–4 curated surprises", "Gift note"],
  },
  {
    name: "A Whole Lot of Nothing",
    price: 89,
    subtitle: "More impact, a better hero item, and room for a premium/custom touch.",
    items: ["Premium NOTHING item", "Premium hero item", "4–5 curated surprises", "Gift note"],
  },
];

const shopperVibes = {
  Wife: {
    mode: "Wife mode",
    headline: "You asked. He shrugged. We know the type.",
    subhead: "He still says he wants nothing. Fine. We’ll turn that into a gift he actually wants to open.",
    reaction: "Of course he did.",
    image: "/he-said-nothing/wife-garage.webp",
    imageAlt: "A relaxed man in his garage workshop",
    theme: { accent: "#b54d35", soft: "#f5ded3", paper: "#fff6f0", deep: "#2e1b18", ink: "#201713" },
  },
  Girlfriend: {
    mode: "Girlfriend mode",
    headline: "He said ‘whatever.’ Bold answer.",
    subhead: "Give us a few clues. We’ll make his impossible answer look like you had a plan all along.",
    reaction: "Nothing? Risky move.",
    image: "/he-said-nothing/girlfriend-apartment.webp",
    imageAlt: "A stylish man relaxing in his apartment",
    theme: { accent: "#107a78", soft: "#d9f3ee", paper: "#f0fbf8", deep: "#073c3e", ink: "#102c2b" },
  },
  Daughter: {
    mode: "Daughter mode",
    headline: "Dad says he needs nothing. Dad is incorrect.",
    subhead: "You know him. You love him. You still have no idea what to buy him. That’s our part.",
    reaction: "Yep. Sounds like Dad.",
    image: "/he-said-nothing/daughter-backyard.webp",
    imageAlt: "A happy dad grilling in the backyard",
    theme: { accent: "#47713c", soft: "#e3efd9", paper: "#f5f9ef", deep: "#1d321f", ink: "#1c2b1b" },
  },
  Mom: {
    mode: "Mom mode",
    headline: "He may be grown. His wish list is not.",
    subhead: "Apparently some things never change. Give us the clues and we’ll take it from here.",
    reaction: "He’s been saying that for years.",
    image: "/he-said-nothing/mom-desk.webp",
    imageAlt: "An adult son at his creative desk",
    theme: { accent: "#3159b8", soft: "#dce7ff", paper: "#f1f5ff", deep: "#172751", ink: "#18264b" },
  },
  Sister: {
    mode: "Sister mode",
    headline: "You’ve known him forever. Still impossible.",
    subhead: "We’ll handle the gift. You can take credit for knowing exactly what he needed.",
    reaction: "Very on brand for him.",
    image: "/he-said-nothing/sister-trail.webp",
    imageAlt: "A brother on a mountain trail",
    theme: { accent: "#c66a32", soft: "#fce4d1", paper: "#fff6ed", deep: "#3e2518", ink: "#342017" },
  },
  Other: {
    mode: "Mystery mode",
    headline: "He gave you zero useful information.",
    subhead: "Tell us what little you do know. We’ll handle the rest.",
    reaction: "Perfect. We specialize in that.",
    image: "/he-said-nothing/other-lounge.webp",
    imageAlt: "A man opening a small gift in a warm lounge",
    theme: { accent: "#865077", soft: "#f3dff0", paper: "#fcf3fb", deep: "#371d34", ink: "#2d182b" },
  },
} as const;

type Shopper = keyof typeof shopperVibes;

const neutralVibe = {
  mode: "Start here",
  headline: "Tell us who he ignored. We’ll take it from there.",
  subhead: "Pick the relationship first, then we’ll tune the jokes, color, and gift experience around her.",
  reaction: "We can work with that.",
  theme: { accent: "#7b5644", soft: "#eadccc", paper: "#f6f1e9", deep: "#26211e", ink: "#201c19" },
};

type PilotCart = {
  id: string;
  status: "active" | "cancelled" | "converted" | "expired";
  subtotalCents: number;
  expiresAt: string;
};

type PilotResponse = {
  success: boolean;
  cart?: PilotCart;
  cartAccessToken?: string;
  checkoutUrl?: string;
  error?: string;
};

type CheckoutAvailability = {
  enabled: boolean;
  mode: "test" | "live" | null;
  shippingCents: number | null;
  premiumPackagingCents: number | null;
};

const pilotProductIds: Record<number, string> = {
  39: "hsn-nothing-box-39",
  59: "hsn-nothing-box-59",
  89: "hsn-nothing-box-89",
};

const saidOptions = [
  "Nothing",
  "Whatever",
  "I don’t care",
  "Don’t get me anything",
  "I already have everything",
  "I don’t know",
  "Surprise me",
];

const interests = [
  "Garage / Tools",
  "Tech / Gadgets",
  "BBQ / Cooking",
  "Cars / Motorcycles",
  "Outdoors",
  "Gaming",
  "Sports",
  "Office / Everyday Carry",
  "A little of everything",
  "I DON'T KNOW — THAT'S WHY I'M HERE",
];

export default function HeSaidNothingStorefront() {
  const [shopper, setShopper] = useState<Shopper | null>(null);
  const [recipient, setRecipient] = useState("Husband");
  const [said, setSaid] = useState("Nothing");
  const [selectedBox, setSelectedBox] = useState(59);
  const [shirtSize, setShirtSize] = useState("Not sure");
  const [waistSize, setWaistSize] = useState("Not sure");
  const [shoeSize, setShoeSize] = useState("Not sure");
  const [interest, setInterest] = useState(interests[9]);
  const [packaging, setPackaging] = useState("Ship It Like Nothing");
  const [giftMessage, setGiftMessage] = useState("");
  const [specialNotes, setSpecialNotes] = useState("");
  const [pilotMode, setPilotMode] = useState(false);
  const [testCheckoutMode, setTestCheckoutMode] = useState(false);
  const [checkoutAvailability, setCheckoutAvailability] = useState<CheckoutAvailability>({
    enabled: false,
    mode: null,
    shippingCents: null,
    premiumPackagingCents: null,
  });
  const [checkoutStatus, setCheckoutStatus] = useState<"idle" | "creating" | "redirecting" | "error">("idle");
  const [checkoutError, setCheckoutError] = useState("");
  const [pilotStatus, setPilotStatus] = useState<"idle" | "creating" | "created" | "cancelling" | "cancelled" | "error">("idle");
  const [pilotCart, setPilotCart] = useState<PilotCart | null>(null);
  const [pilotError, setPilotError] = useState("");
  const pilotIdempotencyKey = useRef<string | null>(null);
  const pilotAccessToken = useRef<string | null>(null);
  const checkoutIdempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    const pilot = new URLSearchParams(window.location.search).get("pilot");
    setPilotMode(pilot === "cart");
    setTestCheckoutMode(pilot === "checkout");
    fetch("/api/he-said-nothing/status", { cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<CheckoutAvailability> : null)
      .then(result => { if (result) setCheckoutAvailability(result); })
      .catch(() => undefined);
  }, []);

  const vibe = shopper ? shopperVibes[shopper] : neutralVibe;
  const selected = useMemo(
    () => boxes.find((box) => box.price === selectedBox) ?? boxes[1],
    [selectedBox]
  );

  async function createPilotCart() {
    setPilotStatus("creating");
    setPilotError("");
    pilotIdempotencyKey.current ??= `hsn-pilot-${crypto.randomUUID()}`;

    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": pilotIdempotencyKey.current,
        },
        body: JSON.stringify({
          items: [{ productId: pilotProductIds[selected.price], quantity: 1 }],
          metadata: {
            source: "he-said-nothing-web-pilot",
            shopper_relationship: shopper ?? "not-selected",
            recipient_relationship: recipient,
            recipient_shirt_size: shirtSize,
            recipient_waist_size: waistSize,
            recipient_shoe_size: shoeSize,
            recipient_interest: interest,
            recipient_answer: said,
            packaging,
            box_tier: String(selected.price),
            product_name: selected.name,
            fulfillment_note: "PILOT TEST CART — NO PAYMENT",
          },
        }),
      });
      const result = await response.json() as PilotResponse;
      if (!response.ok || !result.success || !result.cart) {
        throw new Error(result.error ?? "The pilot cart could not be created.");
      }
      setPilotCart(result.cart);
      pilotAccessToken.current = result.cartAccessToken ?? null;
      pilotIdempotencyKey.current = null;
      setPilotStatus("created");
    } catch (error) {
      setPilotStatus("error");
      setPilotError(error instanceof Error ? error.message : "The pilot cart could not be created.");
    }
  }

  async function cancelPilotCart() {
    if (!pilotCart) return;
    setPilotStatus("cancelling");
    setPilotError("");

    try {
      const response = await fetch(`/api/cart/${pilotCart.id}`, {
        method: "DELETE",
        headers: pilotAccessToken.current
          ? { authorization: `Bearer ${pilotAccessToken.current}` }
          : undefined,
      });
      const result = await response.json() as PilotResponse;
      if (!response.ok || !result.success || !result.cart) {
        throw new Error(result.error ?? "The pilot cart could not be cancelled.");
      }
      setPilotCart(result.cart);
      setPilotStatus("cancelled");
    } catch (error) {
      setPilotStatus("error");
      setPilotError(error instanceof Error ? error.message : "The pilot cart could not be cancelled.");
    }
  }

  async function startCheckout() {
    if (!shopper) {
      setCheckoutError("Choose who he ignored first so we can personalize the box.");
      return;
    }

    setCheckoutStatus("creating");
    setCheckoutError("");
    checkoutIdempotencyKey.current ??= `hsn-checkout-${crypto.randomUUID()}`;

    try {
      const cartResponse = await fetch("/api/cart", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": checkoutIdempotencyKey.current,
        },
        body: JSON.stringify({
          items: [{ productId: pilotProductIds[selected.price], quantity: 1 }],
          metadata: {
            source: testCheckoutMode ? "he-said-nothing-stripe-test" : "he-said-nothing-web",
            shopper_relationship: shopper,
            recipient_relationship: recipient,
            recipient_shirt_size: shirtSize,
            recipient_waist_size: waistSize,
            recipient_shoe_size: shoeSize,
            recipient_interest: interest,
            recipient_answer: said,
            packaging,
            box_tier: String(selected.price),
            product_name: selected.name,
            gift_message: giftMessage.trim(),
            fulfillment_note: specialNotes.trim(),
          },
        }),
      });
      const cartResult = await cartResponse.json() as PilotResponse;
      if (!cartResponse.ok || !cartResult.success || !cartResult.cart) {
        throw new Error(cartResult.error ?? "Your cart could not be created.");
      }

      const checkoutResponse = await fetch(`/api/cart/${cartResult.cart.id}/checkout`, {
        method: "POST",
        headers: cartResult.cartAccessToken
          ? { authorization: `Bearer ${cartResult.cartAccessToken}` }
          : undefined,
      });
      const checkoutResult = await checkoutResponse.json() as PilotResponse;
      if (!checkoutResponse.ok || !checkoutResult.success || !checkoutResult.checkoutUrl) {
        throw new Error(checkoutResult.error ?? "Checkout could not be opened.");
      }

      checkoutIdempotencyKey.current = null;
      setCheckoutStatus("redirecting");
      window.location.assign(checkoutResult.checkoutUrl);
    } catch (error) {
      setCheckoutStatus("error");
      setCheckoutError(error instanceof Error ? error.message : "Checkout could not be opened.");
    }
  }

  const checkoutVisible = checkoutAvailability.enabled
    && (checkoutAvailability.mode === "live" || testCheckoutMode);
  const shippingLabel = checkoutAvailability.shippingCents === null
    ? null
    : `$${(checkoutAvailability.shippingCents / 100).toFixed(2)} shipping`;

  const themeStyle = {
    "--hsn-accent": vibe.theme.accent,
    "--hsn-soft": vibe.theme.soft,
    "--hsn-paper": vibe.theme.paper,
    "--hsn-deep": vibe.theme.deep,
    "--hsn-ink": vibe.theme.ink,
  } as React.CSSProperties;

  return (
    <main style={themeStyle} className="min-h-screen bg-[var(--hsn-paper)] text-[var(--hsn-ink)] transition-colors duration-500">
      <header className="border-b border-black/10 bg-[var(--hsn-paper)]/95 backdrop-blur transition-colors duration-500">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--hsn-accent)]">The gift for men who give you nothing</div>
            <div className="text-xl font-black tracking-tight">HE SAID NOTHING</div>
          </div>
          <div className="hidden rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-black/5 sm:block">
            So we got him exactly what he asked for.
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
        <div className="order-2 lg:order-1">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[var(--hsn-soft)] px-4 py-2 text-sm font-bold text-[var(--hsn-deep)] transition-colors duration-500">
            <Sparkles className="h-4 w-4" /> {vibe.mode}
          </div>
          <h1 className="max-w-3xl text-5xl font-black leading-[.95] tracking-[-.05em] sm:text-6xl">
            HE SAID NOTHING.
            <span className="mt-2 block text-[var(--hsn-accent)]">SO WE GOT HIM NOTHING.</span>
          </h1>
          <div key={shopper ?? "start"} className="mt-7 min-h-[15rem] rounded-[2rem] bg-[var(--hsn-deep)] p-6 text-white shadow-2xl transition-colors duration-500 sm:p-8 animate-[hsnReveal_420ms_ease-out]">
            <div className="text-xs font-black uppercase tracking-[.24em] text-white/55">{shopper ? `Buying for your ${shopper.toLowerCase()}` : "First, choose who he ignored"}</div>
            <h2 className="mt-3 max-w-xl text-3xl font-black leading-[.98] tracking-[-.04em] sm:text-5xl">{vibe.headline}</h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-white/75">{vibe.subhead}</p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold">
            {["Useful > random junk", "Built around him", "You still get the credit"].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm ring-1 ring-black/5">
                <Check className="h-4 w-4" /> {item}
              </div>
            ))}
          </div>
        </div>

        <div className="order-1 rounded-[2rem] bg-[var(--hsn-deep)] p-5 text-white shadow-2xl transition-colors duration-500 lg:order-2 sm:p-6">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 sm:p-6">
            <div className="text-xs font-bold uppercase tracking-[.2em] text-white/50">Start here — this changes the site</div>
            <h2 className="mt-2 text-2xl font-black">Who is he not answering?</h2>
            <p className="mt-2 text-sm leading-6 text-white/65">Pick the person he gave absolutely no useful answer to.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.keys(shopperVibes) as Shopper[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setShopper(value)}
                  className={`rounded-xl px-3 py-3 text-sm font-bold transition ${
                    shopper === value ? "bg-white text-[var(--hsn-deep)] shadow-lg" : "bg-white/10 text-white hover:bg-white/15"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>

            {shopper && "image" in vibe && (
              <>
                <div key={`${shopper}-mobile-message`} aria-live="polite" className="mt-5 rounded-2xl bg-white p-5 text-[var(--hsn-deep)] shadow-lg animate-[hsnReveal_420ms_ease-out]">
                  <div className="text-xs font-black uppercase tracking-[.18em] text-[var(--hsn-accent)]">{vibe.mode}</div>
                  <div className="mt-2 text-2xl font-black leading-tight">{vibe.headline}</div>
                  <p className="mt-2 text-sm leading-6 text-black/65">{vibe.subhead}</p>
                </div>

                <div key={`${shopper}-photo`} className="relative mt-4 h-56 overflow-hidden rounded-2xl bg-black/20 animate-[hsnReveal_420ms_ease-out] sm:h-72">
                  <Image src={vibe.image} alt={vibe.imageAlt} fill priority sizes="(max-width: 1024px) 100vw, 38vw" className="object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent p-5">
                    <div className="text-xs font-black uppercase tracking-[.18em] text-white/65">{vibe.mode}</div>
                    <div className="mt-1 text-xl font-black">This is the guy we&apos;re solving for.</div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="border-y border-black/10 bg-white/70">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-8 lg:grid-cols-[.78fr_1.22fr]">
            <div>
              <div className="text-sm font-bold uppercase tracking-[.2em] text-[var(--hsn-accent)]">The important question</div>
              <h2 className="mt-2 text-3xl font-black tracking-tight">What did he say when you asked what he wanted?</h2>
              <p className="mt-4 leading-7 text-black/60">His answer becomes part of the joke, the gift note, and the box experience.</p>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5 sm:p-8">
              <select value={said} onChange={(e) => setSaid(e.target.value)} className="field text-lg">
                {saidOptions.map((value) => <option key={value}>{value}</option>)}
              </select>
              <div className="mt-5 rounded-2xl bg-[var(--hsn-soft)] p-5 transition-colors duration-500">
                <div className="text-sm font-bold uppercase tracking-wider text-[var(--hsn-accent)]">Our response</div>
                <div className="mt-1 text-2xl font-black">{vibe.reaction}</div>
                <div className="mt-2 text-sm text-black/60">He said: “{said}.” We can work with that.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="mb-8 max-w-2xl">
          <div className="text-sm font-bold uppercase tracking-[.2em] text-[var(--hsn-accent)]">How much Nothing?</div>
          <h2 className="mt-2 text-3xl font-black tracking-tight">Pick the budget. We’ll handle the mystery.</h2>
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {boxes.map((box) => (
            <button
              key={box.price}
              type="button"
              onClick={() => setSelectedBox(box.price)}
              className={`relative rounded-3xl border p-6 text-left transition ${
                selectedBox === box.price
                  ? "border-[var(--hsn-accent)] bg-[var(--hsn-soft)] shadow-xl ring-2 ring-[var(--hsn-accent)]/15"
                  : "border-black/10 bg-white hover:-translate-y-1 hover:shadow-lg"
              }`}
            >
              {box.featured && (
                <div className="absolute -top-3 left-6 rounded-full bg-[var(--hsn-accent)] px-3 py-1 text-xs font-black uppercase tracking-wider text-white">Best place to start</div>
              )}
              <div className="text-4xl font-black">${box.price}</div>
              <div className="mt-3 text-xl font-black">{box.name}</div>
              <p className="mt-2 min-h-16 text-sm leading-6 text-black/55">{box.subtitle}</p>
              <div className="mt-5 space-y-2">
                {box.items.map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-[var(--hsn-accent)]" /> {item}</div>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="border-y border-black/10 bg-[var(--hsn-soft)] transition-colors duration-500">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-8 lg:grid-cols-[.85fr_1.15fr]">
            <div>
              <div className="text-sm font-bold uppercase tracking-[.2em] text-[var(--hsn-accent)]">Make it his</div>
              <h2 className="mt-2 text-3xl font-black tracking-tight">A few clues. Not an interrogation.</h2>
              <p className="mt-4 leading-7 text-black/60">We want enough information to avoid obvious misses without turning gift shopping into homework.</p>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5 sm:p-8">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Who is he to you?">
                  <select value={recipient} onChange={(e) => setRecipient(e.target.value)} className="field">
                    {["Husband", "Boyfriend", "Dad", "Adult son", "Brother", "Grandpa", "Other"].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="Shirt size (optional)">
                  <select value={shirtSize} onChange={(e) => setShirtSize(e.target.value)} className="field">
                    {["Not sure", "S", "M", "L", "XL", "2XL", "3XL+"].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="What kind of guy is he?">
                    <select value={interest} onChange={(e) => setInterest(e.target.value)} className="field">
                      {interests.map((value) => <option key={value}>{value}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Waist size (optional)">
                  <select value={waistSize} onChange={(e) => setWaistSize(e.target.value)} className="field">
                    {["Not sure", "28", "30", "32", "34", "36", "38", "40", "42+"].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <Field label="Shoe size (optional)">
                  <select value={shoeSize} onChange={(e) => setShoeSize(e.target.value)} className="field">
                    {["Not sure", "7", "8", "9", "10", "11", "12", "13", "14+"].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Gift message (optional)">
                    <textarea
                      value={giftMessage}
                      onChange={(e) => setGiftMessage(e.target.value.slice(0, 300))}
                      rows={3}
                      placeholder="Happy birthday. You said you wanted nothing..."
                      className="field resize-y"
                    />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Anything else we should know? (optional)">
                    <textarea
                      value={specialNotes}
                      onChange={(e) => setSpecialNotes(e.target.value.slice(0, 500))}
                      rows={3}
                      placeholder="Favorite team, colors to avoid, allergies, inside jokes, or delivery notes"
                      className="field resize-y"
                    />
                  </Field>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <div className="text-sm font-bold uppercase tracking-[.2em] text-[var(--hsn-accent)]">Packaging</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight">How should Nothing arrive?</h2>
            <p className="mt-4 leading-7 text-black/60">We’ll make the basic option intentionally plain, not accidentally cheap. Premium presentation becomes an easy upsell.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {["Ship It Like Nothing", "Make Nothing Look Expensive"].map((value) => {
              const premium = value === "Make Nothing Look Expensive";
              const premiumUnavailable = premium && checkoutAvailability.premiumPackagingCents === null;
              return (
              <button
                key={value}
                type="button"
                onClick={() => setPackaging(value)}
                disabled={premiumUnavailable}
                className={`rounded-3xl border p-5 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${packaging === value ? "border-[var(--hsn-accent)] bg-[var(--hsn-soft)] ring-2 ring-[var(--hsn-accent)]/15" : "border-black/10 bg-white"}`}
              >
                <Package className="h-7 w-7 text-[var(--hsn-accent)]" />
                <div className="mt-3 font-black">{value}</div>
                <p className="mt-2 text-sm leading-6 text-black/55">
                  {value === "Ship It Like Nothing"
                    ? "Plain-on-purpose box, branded seal, and the joke doing the work."
                    : premiumUnavailable
                      ? "Premium presentation will open after its final price is locked."
                      : `Gift-ready tissue, ribbon/bow, and premium reveal — $${((checkoutAvailability.premiumPackagingCents ?? 0) / 100).toFixed(2)}.`}
                </p>
              </button>
            )})}
          </div>
        </div>
      </section>

      <section className="bg-[var(--hsn-deep)] text-white transition-colors duration-500">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-8 lg:grid-cols-[1fr_.9fr] lg:items-center">
            <div>
              <div className="text-sm font-bold uppercase tracking-[.2em] text-white/50">Your current Nothing</div>
              <h2 className="mt-2 text-3xl font-black">{selected.name} — ${selected.price}</h2>
              <p className="mt-4 max-w-2xl leading-7 text-white/65">
                From a {shopper?.toLowerCase() ?? "gift giver"} for her {recipient.toLowerCase()}. Shirt: {shirtSize}; waist: {waistSize}; shoes: {shoeSize}. He said “{said}.” He leans {interest.toLowerCase()}. Packaging: {packaging}.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 text-sm font-semibold">
                <div className="rounded-full bg-white/10 px-4 py-2">Mystery stays fun</div>
                <div className="rounded-full bg-white/10 px-4 py-2">No obvious junk</div>
                <div className="rounded-full bg-white/10 px-4 py-2">One order flow via VibeCart</div>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <WandSparkles className="h-8 w-8 text-[var(--hsn-soft)]" />
              <div className="mt-3 text-xl font-black">
                {checkoutVisible
                  ? testCheckoutMode
                    ? "Stripe test checkout is ready."
                    : "Ready to send him Nothing?"
                  : "Checkout is safely closed for now."}
              </div>
              <p className="mt-3 text-sm leading-6 text-white/65">
                {checkoutVisible
                  ? `${shippingLabel ?? "Shipping"} is added separately. Stripe securely collects payment and the delivery address.`
                  : "The page is public for testing and indexing. Ordering opens only after shipping, durable orders, merchant access, and the payment test are all configured."}
              </p>
              {checkoutVisible ? (
                <button
                  type="button"
                  onClick={startCheckout}
                  disabled={checkoutStatus === "creating" || checkoutStatus === "redirecting"}
                  className="mt-5 w-full rounded-2xl bg-[var(--hsn-soft)] px-5 py-4 font-black text-[var(--hsn-deep)] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-60"
                >
                  {checkoutStatus === "creating"
                    ? "Building your order…"
                    : checkoutStatus === "redirecting"
                      ? "Opening secure checkout…"
                      : testCheckoutMode
                        ? "Run Stripe test checkout"
                        : `Checkout — $${selected.price}${shippingLabel ? ` + ${shippingLabel}` : ""}`}
                </button>
              ) : (
                <button type="button" disabled className="mt-5 w-full cursor-not-allowed rounded-2xl bg-white/15 px-5 py-4 font-black text-white/60">
                  Ordering opens after payment verification
                </button>
              )}
              {checkoutError ? <p className="mt-3 text-sm font-bold text-red-300" aria-live="polite">{checkoutError}</p> : null}
              {pilotMode && (
                <div className="mt-5 border-t border-white/10 pt-5" aria-live="polite">
                  <div className="text-xs font-black uppercase tracking-[.18em] text-[var(--hsn-soft)]">Private pilot tool</div>
                  <p className="mt-2 text-sm leading-6 text-white/65">
                    This saves the quiz as a VibeCart test cart. It does not open checkout, charge a card, or create a paid order.
                  </p>
                  {pilotCart ? (
                    <div className="mt-4 rounded-2xl bg-black/20 p-4 text-sm">
                      <div className="font-black">Test cart {pilotCart.status}</div>
                      <div className="mt-2 break-all font-mono text-xs text-white/65">{pilotCart.id}</div>
                      <div className="mt-2 text-white/65">
                        ${(pilotCart.subtotalCents / 100).toFixed(2)} · expires {new Date(pilotCart.expiresAt).toLocaleString()}
                      </div>
                    </div>
                  ) : null}
                  {pilotError ? <p className="mt-3 text-sm font-bold text-red-300">{pilotError}</p> : null}
                  {pilotCart?.status === "active" ? (
                    <button
                      type="button"
                      onClick={cancelPilotCart}
                      disabled={pilotStatus === "cancelling"}
                      className="mt-4 w-full rounded-2xl border border-white/20 px-5 py-3 font-black text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                    >
                      {pilotStatus === "cancelling" ? "Cancelling…" : "Cancel test cart"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={createPilotCart}
                      disabled={pilotStatus === "creating"}
                      className="mt-4 w-full rounded-2xl bg-[var(--hsn-soft)] px-5 py-4 font-black text-[var(--hsn-deep)] transition hover:brightness-105 disabled:cursor-wait disabled:opacity-60"
                    >
                      {pilotStatus === "creating" ? "Saving test cart…" : "Create no-payment pilot cart"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-3">
          <Trust icon={<Heart className="h-5 w-5" />} title="Feels personal" text="The shopper relationship changes the tone and experience without making fulfillment complicated." />
          <Trust icon={<Gift className="h-5 w-5" />} title="Useful + funny" text="One branded signature item plus genuinely interesting, useful, or ridiculous surprises." />
          <Trust icon={<Sparkles className="h-5 w-5" />} title="Easy to buy" text="A few answers, one clear recommendation, and no endless catalog browsing." />
        </div>
      </section>

      <footer className="border-t border-black/10 bg-[var(--hsn-paper)] px-5 py-8 text-sm text-black/55">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div className="font-black text-[var(--hsn-ink)]">HE SAID NOTHING</div>
          <div className="flex flex-wrap gap-5">
            <Link href="/he-said-nothing/policies" className="font-semibold hover:text-[var(--hsn-accent)]">Shipping, returns & privacy</Link>
            <Link href="/he-said-nothing/admin" className="font-semibold hover:text-[var(--hsn-accent)]">Merchant sign in</Link>
          </div>
        </div>
      </footer>

      <style jsx global>{`
        .field {
          width: 100%;
          border-radius: 1rem;
          border: 1px solid rgba(0,0,0,.12);
          background: #fff;
          padding: .9rem 1rem;
          font-weight: 650;
          outline: none;
        }
        .field:focus { border-color: var(--hsn-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--hsn-accent) 18%, transparent); }
        @keyframes hsnReveal {
          from { opacity: 0; transform: translateY(10px) scale(.99); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-black">{label}</span>{children}</label>;
}

function Trust({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="flex gap-3"><div className="mt-1 text-[var(--hsn-accent)]">{icon}</div><div><div className="font-black">{title}</div><p className="mt-1 text-sm leading-6 text-black/55">{text}</p></div></div>;
}
