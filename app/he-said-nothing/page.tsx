"use client";

import { useMemo, useState } from "react";
import { Check, Gift, Heart, Package, Sparkles } from "lucide-react";

const boxes = [
  {
    name: "Just Get Him Something Cool",
    price: 39,
    subtitle: "A smart little win when you need a gift without the guessing.",
    items: ["Signature socks", "3D-printed phone stand", "2–3 useful surprises"],
  },
  {
    name: "He Said He Wants Nothing",
    price: 59,
    featured: true,
    subtitle: "Our main box. Built around what kind of guy he actually is.",
    items: ["Signature socks", "3D-printed phone stand", "1 hero item", "3–4 useful/fun surprises"],
  },
  {
    name: "Okay, Impress Him",
    price: 89,
    subtitle: "More impact, a better hero item, and room for personalization.",
    items: ["Signature socks", "Personalized 3D item", "Premium hero item", "4–5 curated surprises"],
  },
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
  const [selectedBox, setSelectedBox] = useState(59);
  const [relationship, setRelationship] = useState("Husband");
  const [age, setAge] = useState("30–44");
  const [interest, setInterest] = useState(interests[9]);
  const [sockStyle, setSockStyle] = useState("Fun but wearable");

  const selected = useMemo(
    () => boxes.find((box) => box.price === selectedBox) ?? boxes[1],
    [selectedBox]
  );

  return (
    <main className="min-h-screen bg-[#fbf7f2] text-[#27221f]">
      <header className="border-b border-black/10 bg-[#fbf7f2]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8b5e4a]">Gift problem solved</div>
            <div className="text-xl font-black tracking-tight">HE SAID NOTHING</div>
          </div>
          <div className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-black/5">
            For the guy who gives you zero ideas.
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[1.08fr_.92fr] lg:items-center">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#efe1d5] px-4 py-2 text-sm font-bold text-[#704431]">
            <Sparkles className="h-4 w-4" /> He said he doesn’t want anything. Fine.
          </div>
          <h1 className="max-w-3xl text-5xl font-black leading-[.98] tracking-[-.04em] sm:text-6xl">
            Stop trying to figure out what to buy him.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-black/65">
            Tell us who he is, what he’s into, and your budget. We build a gift box that feels picked for him — without making you hunt through 47 tabs first.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm font-semibold">
            {["Socks in every box", "Useful > random junk", "Built for husbands, dads, boyfriends & sons"].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-sm ring-1 ring-black/5">
                <Check className="h-4 w-4" /> {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] bg-[#2f2925] p-6 text-white shadow-2xl">
          <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm uppercase tracking-[.18em] text-white/55">The signature</div>
                <div className="mt-1 text-2xl font-black">Yes, there are socks.</div>
              </div>
              <Gift className="h-10 w-10 text-[#e4b18d]" />
            </div>
            <p className="mt-4 leading-7 text-white/70">
              Men always get socks. We’re making it part of the joke — then surrounding them with things he’ll actually want to open.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-white/10 p-4"><div className="font-bold">Made by us</div><div className="mt-1 text-white/60">3D-printed phone stand</div></div>
              <div className="rounded-2xl bg-white/10 p-4"><div className="font-bold">Hero item</div><div className="mt-1 text-white/60">Matched to his interests</div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-black/10 bg-white/70">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="mb-8 max-w-2xl">
            <div className="text-sm font-bold uppercase tracking-[.2em] text-[#8b5e4a]">Pick your budget</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight">We’ll handle the hard part.</h2>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {boxes.map((box) => (
              <button
                key={box.price}
                type="button"
                onClick={() => setSelectedBox(box.price)}
                className={`relative rounded-3xl border p-6 text-left transition ${
                  selectedBox === box.price
                    ? "border-[#8b5e4a] bg-[#fffaf6] shadow-xl ring-2 ring-[#8b5e4a]/10"
                    : "border-black/10 bg-white hover:-translate-y-1 hover:shadow-lg"
                }`}
              >
                {box.featured && (
                  <div className="absolute -top-3 left-6 rounded-full bg-[#8b5e4a] px-3 py-1 text-xs font-black uppercase tracking-wider text-white">Most giftable</div>
                )}
                <div className="text-4xl font-black">${box.price}</div>
                <div className="mt-3 text-xl font-black">{box.name}</div>
                <p className="mt-2 min-h-12 text-sm leading-6 text-black/55">{box.subtitle}</p>
                <div className="mt-5 space-y-2">
                  {box.items.map((item) => (
                    <div key={item} className="flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-[#8b5e4a]" /> {item}</div>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-8 lg:grid-cols-[.78fr_1.22fr]">
          <div>
            <div className="text-sm font-bold uppercase tracking-[.2em] text-[#8b5e4a]">Tell us about him</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight">You don’t need to know exactly what he wants.</h2>
            <p className="mt-4 leading-7 text-black/60">That is literally why this exists. A few clues are enough for us to build the right kind of box.</p>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-xl ring-1 ring-black/5 sm:p-8">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Who is he?">
                <select value={relationship} onChange={(e) => setRelationship(e.target.value)} className="field">
                  {["Husband", "Boyfriend", "Dad", "Adult son", "Brother", "Other"].map((value) => <option key={value}>{value}</option>)}
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
              <div className="sm:col-span-2">
                <Field label="Sock personality">
                  <select value={sockStyle} onChange={(e) => setSockStyle(e.target.value)} className="field">
                    {["Fun but wearable", "Plain / classic", "Bold / funny", "Dealer's choice"].map((value) => <option key={value}>{value}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            <div className="mt-7 rounded-2xl bg-[#f5ede7] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-bold uppercase tracking-wider text-[#8b5e4a]">Your box</div>
                  <div className="mt-1 text-xl font-black">{selected.name} — ${selected.price}</div>
                  <div className="mt-2 text-sm text-black/60">For your {relationship.toLowerCase()}, age {age}, leaning {interest.toLowerCase()}.</div>
                </div>
                <Package className="h-10 w-10 shrink-0 text-[#8b5e4a]" />
              </div>
              <button type="button" className="mt-5 w-full rounded-2xl bg-[#2f2925] px-5 py-4 text-base font-black text-white shadow-lg transition hover:-translate-y-0.5">
                Checkout coming after first box is locked
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-black/45">Prototype storefront only. No payment is collected yet.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#2f2925] text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-3">
          <Trust icon={<Heart className="h-5 w-5" />} title="Made to feel personal" text="We use a few clues instead of throwing generic filler in a box." />
          <Trust icon={<Gift className="h-5 w-5" />} title="Useful + fun" text="One good hero item, useful smaller items, and the required socks." />
          <Trust icon={<Sparkles className="h-5 w-5" />} title="Easy for the buyer" text="Pick the budget, answer a few questions, and stop overthinking his gift." />
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
        .field:focus { border-color: #8b5e4a; box-shadow: 0 0 0 3px rgba(139,94,74,.10); }
      `}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-black">{label}</span>{children}</label>;
}

function Trust({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="flex gap-3"><div className="mt-1 text-[#e4b18d]">{icon}</div><div><div className="font-black">{title}</div><p className="mt-1 text-sm leading-6 text-white/60">{text}</p></div></div>;
}
