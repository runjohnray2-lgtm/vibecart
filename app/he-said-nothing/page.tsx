"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
    kicker: "You asked. He shrugged. We know the type.",
    headline: "You’ve asked him enough times.",
    subhead: "He still says he wants nothing. Fine. We’ll turn that into a gift he actually wants to open.",
    reaction: "Of course he did.",
  },
  Girlfriend: {
    kicker: "He said ‘whatever.’ Bold answer.",
    headline: "Dating him shouldn’t require a gift detective.",
    subhead: "Give us a few clues. We’ll make his impossible answer look like you had a plan all along.",
    reaction: "Nothing? Risky move.",
  },
  Daughter: {
    kicker: "Dad says he needs nothing. Dad is incorrect.",
    headline: "Classic Dad.",
    subhead: "You know him. You love him. You still have no idea what to buy him. That’s our part.",
    reaction: "Yep. Sounds like Dad.",
  },
  Mom: {
    kicker: "He may be grown. His wish list is not.",
    headline: "He still can’t tell you what he wants.",
    subhead: "Apparently some things never change. Give us the clues and we’ll take it from here.",
    reaction: "He’s been saying that for years.",
  },
  Sister: {
    kicker: "You’ve known him forever. Still impossible.",
    headline: "Sibling knowledge only gets you so far.",
    subhead: "We’ll handle the gift. You can take credit for knowing exactly what he needed.",
    reaction: "Very on brand for him.",
  },
  Other: {
    kicker: "He gave you zero useful information.",
    headline: "Good. That’s literally our specialty.",
    subhead: "Tell us what little you do know. We’ll handle the rest.",
    reaction: "Perfect. We specialize in that.",
  },
} as const;

type Shopper = keyof typeof shopperVibes;

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
  error?: string;
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
  const [shopper, setShopper] = useState<Shopper>("Wife");
  const [recipient, setRecipient] = useState("Husband");
  const [said, setSaid] = useState("Nothing");
  const [selectedBox, setSelectedBox] = useState(59);
  const [age, setAge] = useState("30–44");
  const [interest, setInterest] = useState(interests[9]);
  const [packaging, setPackaging] = useState("Ship It Like Nothing");
  const [pilotMode, setPilotMode] = useState(false);
  const [pilotStatus, setPilotStatus] = useState<"idle" | "creating" | "created" | "cancelling" | "cancelled" | "error">("idle");
  const [pilotCart, setPilotCart] = useState<PilotCart | null>(null);
  const [pilotError, setPilotError] = useState("");
  const pilotIdempotencyKey = useRef<string | null>(null);
  const pilotAccessToken = useRef<string | null>(null);

  useEffect(() => {
    setPilotMode(new URLSearchParams(window.location.search).get("pilot") === "cart");
  }, []);

  const vibe = shopperVibes[shopper];
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
            shopper_relationship: shopper,
            recipient_relationship: recipient,
            recipient_age: age,
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

  return (
    <main className="min-h-screen bg-[#f6f1e9] text-[#201c19]">
      <header className="border-b border-black/10 bg-[#f6f1e9]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#7b5644]">The gift for men who give you nothing</div>
            <div className="text-xl font-black tracking-tight">HE SAID NOTHING</div>
          </div>
          <div className="hidden rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-black/5 sm:block">
            So we got him exactly what he asked for.
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#eadccc] px-4 py-2 text-sm font-bold text-[#694332]">
            <Sparkles className="h-4 w-4" /> {vibe.kicker}
          </div>
          <h1 className="max-w-3xl text-5xl font-black leading-[.95] tracking-[-.05em] sm:text-6xl">
            HE SAID NOTHING.
            <span className="mt-2 block text-[#7b5644]">SO WE GOT HIM NOTHING.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-black/65">{vibe.subhead}</p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold">
            {["Useful > random junk", "Built around him", "You still get the credit"].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm ring-1 ring-black/5">
                <Check className="h-4 w-4" /> {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] bg-[#26211e] p-5 text-white shadow-2xl sm:p-6">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 sm:p-6">
            <div className="text-xs font-bold uppercase tracking-[.2em] text-white/50">Start here</div>
            <h2 className="mt-2 text-2xl font-black">Who are you?</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.keys(shopperVibes) as Shopper[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setShopper(value)}
                  className={`rounded-xl px-3 py-3 text-sm font-bold transition ${
                    shopper === value ? "bg-white text-[#26211e]" : "bg-white/10 text-white hover:bg-white/15"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>

            <div className="mt-6 rounded-2xl bg-white/10 p-5">
              <div className="text-sm text-white/55">Your version of the site</div>
              <div className="mt-1 text-xl font-black">{vibe.headline}</div>
              <p className="mt-2 text-sm leading-6 text-white/70">The jokes and recommendations change with you. The fulfillment stays simple for us.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-black/10 bg-white/70">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-8 lg:grid-cols-[.78fr_1.22fr]">
            <div>
              <div className="text-sm font-bold uppercase tracking-[.2em] text-[#7b5644]">The important question</div>
              <h2 className="mt-2 text-3xl font-black tracking-tight">What did he say when you asked what he wanted?</h2>
              <p className="mt-4 leading-7 text-black/60">His answer becomes part of the joke, the gift note, and the box experience.</p>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5 sm:p-8">
              <select value={said} onChange={(e) => setSaid(e.target.value)} className="field text-lg">
                {saidOptions.map((value) => <option key={value}>{value}</option>)}
              </select>
              <div className="mt-5 rounded-2xl bg-[#f1e7dc] p-5">
                <div className="text-sm font-bold uppercase tracking-wider text-[#7b5644]">Our response</div>
                <div className="mt-1 text-2xl font-black">{vibe.reaction}</div>
                <div className="mt-2 text-sm text-black/60">He said: “{said}.” We can work with that.</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="mb-8 max-w-2xl">
          <div className="text-sm font-bold uppercase tracking-[.2em] text-[#7b5644]">How much Nothing?</div>
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
                  ? "border-[#7b5644] bg-[#fffaf5] shadow-xl ring-2 ring-[#7b5644]/10"
                  : "border-black/10 bg-white hover:-translate-y-1 hover:shadow-lg"
              }`}
            >
              {box.featured && (
                <div className="absolute -top-3 left-6 rounded-full bg-[#7b5644] px-3 py-1 text-xs font-black uppercase tracking-wider text-white">Best place to start</div>
              )}
              <div className="text-4xl font-black">${box.price}</div>
              <div className="mt-3 text-xl font-black">{box.name}</div>
              <p className="mt-2 min-h-16 text-sm leading-6 text-black/55">{box.subtitle}</p>
              <div className="mt-5 space-y-2">
                {box.items.map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-[#7b5644]" /> {item}</div>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="border-y border-black/10 bg-[#eee4d8]">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-8 lg:grid-cols-[.85fr_1.15fr]">
            <div>
              <div className="text-sm font-bold uppercase tracking-[.2em] text-[#7b5644]">Make it his</div>
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
                <Field label="Age">
                  <select value={age} onChange={(e) => setAge(e.target.value)} className="field">
                    {["18–29", "30–44", "45–59", "60+"].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="What kind of guy is he?">
                    <select value={interest} onChange={(e) => setInterest(e.target.value)} className="field">
                      {interests.map((value) => <option key={value}>{value}</option>)}
                    </select>
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
            <div className="text-sm font-bold uppercase tracking-[.2em] text-[#7b5644]">Packaging</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight">How should Nothing arrive?</h2>
            <p className="mt-4 leading-7 text-black/60">We’ll make the basic option intentionally plain, not accidentally cheap. Premium presentation becomes an easy upsell.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {["Ship It Like Nothing", "Make Nothing Look Expensive"].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPackaging(value)}
                className={`rounded-3xl border p-5 text-left transition ${packaging === value ? "border-[#7b5644] bg-[#fffaf5] ring-2 ring-[#7b5644]/10" : "border-black/10 bg-white"}`}
              >
                <Package className="h-7 w-7 text-[#7b5644]" />
                <div className="mt-3 font-black">{value}</div>
                <p className="mt-2 text-sm leading-6 text-black/55">
                  {value === "Ship It Like Nothing"
                    ? "Plain-on-purpose box, branded seal, and the joke doing the work."
                    : "Gift-ready presentation with nicer tissue, ribbon/bow, and premium reveal."}
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#26211e] text-white">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-8 lg:grid-cols-[1fr_.9fr] lg:items-center">
            <div>
              <div className="text-sm font-bold uppercase tracking-[.2em] text-white/50">Your current Nothing</div>
              <h2 className="mt-2 text-3xl font-black">{selected.name} — ${selected.price}</h2>
              <p className="mt-4 max-w-2xl leading-7 text-white/65">
                From a {shopper.toLowerCase()} for her {recipient.toLowerCase()}, age {age}. He said “{said}.” He leans {interest.toLowerCase()}. Packaging: {packaging}.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 text-sm font-semibold">
                <div className="rounded-full bg-white/10 px-4 py-2">Mystery stays fun</div>
                <div className="rounded-full bg-white/10 px-4 py-2">No obvious junk</div>
                <div className="rounded-full bg-white/10 px-4 py-2">One order flow via VibeCart</div>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <WandSparkles className="h-8 w-8 text-[#e0b38e]" />
              <div className="mt-3 text-xl font-black">Checkout is intentionally off for now.</div>
              <p className="mt-3 text-sm leading-6 text-white/65">We’re locking the first real box contents, costs, shipping, and fulfillment before taking money. The storefront experience can still go live early for indexing and testing.</p>
              <button type="button" disabled className="mt-5 w-full cursor-not-allowed rounded-2xl bg-white/15 px-5 py-4 font-black text-white/60">
                Ordering opens after prototype validation
              </button>
              {pilotMode && (
                <div className="mt-5 border-t border-white/10 pt-5" aria-live="polite">
                  <div className="text-xs font-black uppercase tracking-[.18em] text-[#e0b38e]">Private pilot tool</div>
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
                      className="mt-4 w-full rounded-2xl bg-[#e0b38e] px-5 py-4 font-black text-[#26211e] transition hover:bg-[#edc7a7] disabled:cursor-wait disabled:opacity-60"
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
        .field:focus { border-color: #7b5644; box-shadow: 0 0 0 3px rgba(123,86,68,.12); }
      `}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-black">{label}</span>{children}</label>;
}

function Trust({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="flex gap-3"><div className="mt-1 text-[#7b5644]">{icon}</div><div><div className="font-black">{title}</div><p className="mt-1 text-sm leading-6 text-black/55">{text}</p></div></div>;
}
