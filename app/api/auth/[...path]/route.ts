import { getAuth } from "@/lib/auth/server"

export const dynamic = "force-dynamic"

type AuthRouteContext = { params: Promise<{ path: string[] }> }

export async function GET(request: Request, context: AuthRouteContext) {
  return getAuth().handler().GET(request, context)
}

export async function POST(request: Request, context: AuthRouteContext) {
  return getAuth().handler().POST(request, context)
}
