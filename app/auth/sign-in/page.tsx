"use client"

import { FormEvent, Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { authClient } from "@/lib/auth/client"

export default function SignInPage() {
  return (
    <Suspense fallback={<SignInFallback />}>
      <SignInForm />
    </Suspense>
  )
}

function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next") || "/apps/links"
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name || email.split("@")[0] })

      if (result.error) {
        setError(result.error.message || "Authentication failed")
        return
      }
      router.push(next)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-14 text-neutral-100">
      <div className="mx-auto max-w-md">
        <p className="font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-400">VibeCart App Factory</p>
        <h1 className="mt-4 text-4xl font-bold">{mode === "sign-in" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-3 text-neutral-400">One account for the VibeCart app library.</p>

        <form onSubmit={submit} className="mt-8 space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          {mode === "sign-up" && (
            <label className="block text-sm">
              <span className="text-neutral-300">Name</span>
              <input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-emerald-500" autoComplete="name" />
            </label>
          )}
          <label className="block text-sm">
            <span className="text-neutral-300">Email</span>
            <input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-emerald-500" autoComplete="email" />
          </label>
          <label className="block text-sm">
            <span className="text-neutral-300">Password</span>
            <input required minLength={8} type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-emerald-500" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} />
          </label>
          {error && <p className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}
          <button disabled={busy} className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 font-semibold text-neutral-950 disabled:opacity-50">
            {busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")} className="mt-4 text-sm text-emerald-400 hover:text-emerald-300">
          {mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  )
}

function SignInFallback() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-14 text-neutral-100">
      <div className="mx-auto max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-400">
        Loading sign in…
      </div>
    </main>
  )
}
