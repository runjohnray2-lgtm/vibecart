import { NextResponse } from "next/server"
import {
  HSN_ADMIN_COOKIE,
  issueHsnAdminSession,
  verifyHsnAdminPassword,
} from "@/lib/hsn-admin-auth"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const form = await req.formData()
  const candidate = form.get("password")
  if (typeof candidate !== "string" || !verifyHsnAdminPassword(candidate)) {
    return NextResponse.redirect(new URL("/he-said-nothing/admin/login?error=1", req.url), 303)
  }

  const session = issueHsnAdminSession()
  if (!session) {
    return NextResponse.json({ success: false, error: "Admin access is not configured." }, { status: 503 })
  }

  const response = NextResponse.redirect(new URL("/he-said-nothing/admin", req.url), 303)
  response.cookies.set(HSN_ADMIN_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: session.maxAge,
  })
  return response
}
