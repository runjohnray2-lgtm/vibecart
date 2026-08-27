import { NextResponse } from "next/server"
import { HSN_ADMIN_COOKIE } from "@/lib/hsn-admin-auth"

export async function POST(req: Request) {
  const response = NextResponse.redirect(new URL("/he-said-nothing/admin/login", req.url), 303)
  response.cookies.set(HSN_ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  })
  return response
}
