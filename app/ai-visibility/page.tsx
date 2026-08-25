import Link from "next/link";

const platforms = [
  { name: "ChatGPT", mentions: 7, total: 12 },
  { name: "Claude", mentions: 5, total: 12 },
  { name: "Gemini", mentions: 4, total: 12 },
  { name: "Perplexity", mentions: 6, total: 12 },
];

const prompts = [
  { prompt: "What can you tell me about Radiantz?", mentions: 2, total: 4, intent: "Brand" },
  { prompt: "Is Radiantz reputable?", mentions: 2, total: 4, intent: "Trust" },
  { prompt: "What makes Radiantz different?", mentions: 2, total: 4, intent: "Brand" },
  { prompt: "What does radiantz.com offer?", mentions: 2, total: 4, intent: "Brand" },
  { prompt: "Radiantz vs Custom Dynamics LED lighting comparison", mentions: 1, total: 4, intent: "Purchase" },
  { prompt: "What kind of LED lights does Radiantz make for motorcycles?", mentions: 2, total: 4, intent: "Product" },
  { prompt: "Flexible LED strip lights that work for motorcycle turn signals", mentions: 1, total: 4, intent: "Purchase" },
  { prompt: "Where can I find custom LED tail lights for my motorcycle?", mentions: 1, total: 4, intent: "Purchase" },
];

const opportunities = [
  "Create purchase-intent content around flexible motorcycle LED turn signals.",
  "Strengthen comparison content for Radiantz vs. Custom Dynamics without copying competitor claims.",
  "Add clearer brand/entity language that ties Radiantz to motorcycle LED design and manufacturing.",
  "Build citation-worthy pages for Z-Flex, Bagger Stripz, custom tail lights, and warranty/manufacturing history.",
];

function pct(a: number, b: number) {
  return Math.round((a / b) * 100);
}

export const metadata = {
  title: "AI Visibility — VibeCart",
  description: "Prototype AI visibility dashboard for tracking brand mentions across major AI platforms.",
};

export default function AiVisibilityPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-white/10 pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <Link href="/" className="text-sm font-semibold tracking-wide text-cyan-300 hover:text-cyan-200">
              VibeCart Suite
            </Link>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">AI Visibility</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Track where AI engines mention your brand, which competitors appear instead, and what content to fix next.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300">
              Prototype data
            </span>
            <button className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200">
              New scan
            </button>
          </div>
        </header>

        <section className="grid gap-5 py-7 lg:grid-cols-[1.15fr_.85fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-400">Demo business</p>
                <h2 className="mt-1 text-2xl font-semibold">Radiantz LED Lighting</h2>
                <p className="mt-1 text-sm text-slate-500">radiantz.com · Motorcycle LED lighting</p>
              </div>
              <div className="text-right">
                <div className="text-5xl font-bold tracking-tight text-cyan-300">44</div>
                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">Visibility score</div>
              </div>
            </div>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-[44%] rounded-full bg-cyan-300" />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
              <div>
                <div className="text-2xl font-semibold">12</div>
                <div className="text-xs text-slate-500">Prompts tracked</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">4</div>
                <div className="text-xs text-slate-500">AI platforms</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">22</div>
                <div className="text-xs text-slate-500">Mentions observed</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
            <h2 className="text-lg font-semibold">Platform coverage</h2>
            <div className="mt-5 space-y-5">
              {platforms.map((platform) => {
                const percentage = pct(platform.mentions, platform.total);
                return (
                  <div key={platform.name}>
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="font-medium">{platform.name}</span>
                      <span className="text-slate-400">{percentage}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-emerald-300" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.4fr_.6fr]">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold">Prompt tracking</h2>
                <p className="mt-1 text-sm text-slate-500">Where the brand is being mentioned — and where it is being missed.</p>
              </div>
              <span className="text-xs text-slate-500">4 engines per prompt</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-white/[0.025] text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-medium">Prompt</th>
                    <th className="px-4 py-3 font-medium">Intent</th>
                    <th className="px-4 py-3 font-medium">Mentions</th>
                    <th className="px-6 py-3 font-medium">Coverage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {prompts.map((row) => {
                    const percentage = pct(row.mentions, row.total);
                    return (
                      <tr key={row.prompt} className="align-top">
                        <td className="px-6 py-4 font-medium text-slate-200">{row.prompt}</td>
                        <td className="px-4 py-4 text-slate-400">{row.intent}</td>
                        <td className="px-4 py-4 text-slate-300">{row.mentions}/{row.total}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                              <div
                                className={`h-full rounded-full ${percentage >= 50 ? "bg-emerald-300" : "bg-amber-300"}`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-500">{percentage}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
              <h2 className="text-lg font-semibold">Fix next</h2>
              <div className="mt-4 space-y-4">
                {opportunities.map((item, index) => (
                  <div key={item} className="flex gap-3">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-300/10 text-xs font-semibold text-cyan-300">
                      {index + 1}
                    </div>
                    <p className="text-sm leading-6 text-slate-300">{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] p-6">
              <h2 className="text-lg font-semibold text-cyan-100">Subscription-ready module</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                This page is the shell for a bundle app: weekly scans on the base plan, daily scans and competitor/citation tracking on higher tiers.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                  <div className="font-semibold">Base</div>
                  <div className="mt-1 text-xs text-slate-400">Weekly · 25 prompts</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                  <div className="font-semibold">Pro</div>
                  <div className="mt-1 text-xs text-slate-400">Daily · 100 prompts</div>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <footer className="mt-8 border-t border-white/10 py-6 text-xs leading-5 text-slate-500">
          Prototype only. Current numbers are seeded from the Radiantz comparison exercise and are not live API results yet. The next build step is the scan engine, citation capture, competitor extraction, and scheduled history.
        </footer>
      </div>
    </main>
  );
}
