import Link from "next/link"

const endpoint = "https://vibecart.vercel.app/mcp"
const cloudUrl = "https://vibecart-cloud-uupzkh.v2.appdeploy.ai/"

const clientRecipes = [
  {
    name: "Claude Code",
    code: `claude mcp add --transport http vibecart ${endpoint}`,
  },
  {
    name: "VS Code",
    code: `{
  "servers": {
    "vibecart": {
      "type": "http",
      "url": "${endpoint}"
    }
  }
}`,
  },
  {
    name: "OpenAI Responses API",
    code: `{
  "type": "mcp",
  "server_label": "vibecart",
  "server_url": "${endpoint}",
  "require_approval": "always"
}`,
  },
]

export default function StartPage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100 md:py-16">
      <div className="mx-auto max-w-5xl space-y-12">
        <header className="space-y-5">
          <Link href="/" className="text-sm text-neutral-400 hover:text-white">← VibeCart</Link>
          <p className="font-mono text-sm font-semibold uppercase tracking-[0.18em] text-emerald-400">Quickstart</p>
          <h1 className="max-w-4xl text-4xl font-bold leading-tight md:text-6xl">Connect an agent to VibeCart in minutes.</h1>
          <p className="max-w-3xl text-lg leading-8 text-neutral-400">
            VibeCart uses one public Streamable HTTP MCP endpoint. Connect your client to Core for free, or use VibeCart Cloud when you want the managed order/event infrastructure.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href={cloudUrl} className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-neutral-950 hover:bg-emerald-400">
              Start Cloud — $29/month
            </a>
            <a href="/agents.md" className="rounded-lg border border-neutral-700 px-5 py-3 font-semibold hover:border-neutral-500">
              Full agent guide
            </a>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-400">Canonical MCP endpoint</p>
            <code className="mt-4 block overflow-x-auto rounded-lg bg-neutral-950 p-4 text-sm text-emerald-200">{endpoint}</code>
            <p className="mt-4 text-sm leading-6 text-neutral-400">
              Generic MCP clients use this endpoint. Keep approval prompts enabled for state-changing commerce tools unless you have deliberately established a trusted policy.
            </p>
          </article>
          <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-400">Official MCP Registry</p>
            <p className="mt-4 text-lg font-semibold">io.github.runjohnray2-lgtm/vibecart</p>
            <p className="mt-3 text-sm leading-6 text-neutral-400">
              VibeCart is published and verified in the official MCP Registry. The repository automatically republishes and verifies its Registry record when metadata changes.
            </p>
          </article>
        </section>

        <section className="space-y-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-400">Connect a client</p>
            <h2 className="mt-2 text-3xl font-bold">Use the same backend everywhere.</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {clientRecipes.map(recipe => (
              <article key={recipe.name} className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <h3 className="font-semibold">{recipe.name}</h3>
                <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg bg-neutral-950 p-4 text-xs leading-6 text-neutral-300">{recipe.code}</pre>
              </article>
            ))}
          </div>
          <p className="text-sm text-neutral-500">
            Claude, Gemini, Cursor, Codex, ChatGPT, VS Code and other MCP clients all use the shared Core. See the full guide for provider-specific notes and current product UI details.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-sm text-emerald-400">1 · Connect</p>
            <h3 className="mt-2 text-xl font-semibold">Point the agent at `/mcp`.</h3>
            <p className="mt-3 text-sm leading-6 text-neutral-400">The agent can inspect products and create trusted one- or multi-item checkout sessions.</p>
          </article>
          <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-sm text-emerald-400">2 · Adapt</p>
            <h3 className="mt-2 text-xl font-semibold">Use your product source.</h3>
            <p className="mt-3 text-sm leading-6 text-neutral-400">Self-hosters replace the reference catalog lookup with their own database/CMS while keeping server-side pricing authoritative.</p>
          </article>
          <article className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-sm text-emerald-400">3 · Go live</p>
            <h3 className="mt-2 text-xl font-semibold">Keep your Stripe account.</h3>
            <p className="mt-3 text-sm leading-6 text-neutral-400">Configure Stripe secrets server-side. Checkout revenue settles directly to the merchant; VibeCart takes no percentage of merchant sales.</p>
          </article>
        </section>

        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-7 md:p-9">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-300">Self-host Core</p>
              <p className="mt-3 text-3xl font-bold">Free</p>
              <p className="mt-3 text-sm leading-6 text-neutral-300">Run the reference implementation yourself, keep your Stripe account, adapt the trusted catalog source, and use MCP/UCP directly.</p>
              <a className="mt-5 inline-block font-semibold text-emerald-200 hover:text-white" href="https://github.com/runjohnray2-lgtm/vibecart">Open GitHub →</a>
            </div>
            <div className="border-t border-emerald-500/20 pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-300">VibeCart Cloud</p>
              <p className="mt-3 text-3xl font-bold">$29<span className="text-base font-normal text-neutral-400"> / month</span></p>
              <p className="mt-3 text-sm leading-6 text-neutral-300">Managed durable events/orders, fulfillment webhook delivery, retries, monitoring, updates and support around the free Core.</p>
              <a className="mt-5 inline-block font-semibold text-emerald-200 hover:text-white" href={cloudUrl}>Open Cloud workspace →</a>
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap gap-5 border-t border-neutral-800 pt-6 text-sm text-neutral-500">
          <Link href="/" className="hover:text-neutral-200">Home</Link>
          <Link href="/cloud" className="hover:text-neutral-200">Cloud</Link>
          <a href="/mcp-clients.json" className="hover:text-neutral-200">Client manifest</a>
          <a href="/llms.txt" className="hover:text-neutral-200">LLM notes</a>
          <a href="/.well-known/ucp" className="hover:text-neutral-200">UCP discovery</a>
        </footer>
      </div>
    </main>
  )
}
