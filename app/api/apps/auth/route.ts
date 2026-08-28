import { NextRequest, NextResponse } from "next/server"
import { getAuth } from "@/lib/auth/server"

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin")
  if (!origin) return false
  try {
    return new URL(origin).host === req.nextUrl.host
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }

  try {
    const body = await req.json()
    const mode = body.mode === "sign-up" ? "sign-up" : "sign-in"
    const email = String(body.email ?? "").trim().toLowerCase()
    const password = String(body.password ?? "")
    const name = String(body.name ?? "").trim() || email.split("@")[0]

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 })
    }

    const result = mode === "sign-up"
      ? await getAuth().signUp.email({ email, password, name })
      : await getAuth().signIn.email({ email, password })

    if (result.error) {
      return NextResponse.json({ error: result.error.message || "Authentication failed" }, { status: 400 })
    }

    return NextResponse.json({ ok: true, user: result.data?.user ?? null })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
