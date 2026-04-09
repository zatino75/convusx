import type { IncomingMessage } from "node:http"

function getAdminToken(): string {
  return String(process.env.ADMIN_API_TOKEN ?? "").trim()
}

export function isLocalRequest(req: IncomingMessage): boolean {
  const host = String(req.headers?.host ?? "").toLowerCase()
  const origin = String(req.headers?.origin ?? "").toLowerCase()
  const remoteAddr = String((req as any).socket?.remoteAddress ?? "")

  return (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1") ||
    remoteAddr === "127.0.0.1" ||
    remoteAddr === "::1" ||
    remoteAddr === "::ffff:127.0.0.1"
  )
}

export function isAuthenticated(req: IncomingMessage): boolean {
  const adminToken = getAdminToken()

  // If no admin token configured, allow localhost only
  if (!adminToken) {
    return isLocalRequest(req)
  }

  // Check Authorization header
  const authHeader = String(req.headers?.authorization ?? "").trim()
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7).trim() === adminToken) {
    return true
  }

  // Check query param (for simple GET requests)
  const url = new URL(req.url ?? "/", "http://localhost")
  if (url.searchParams.get("token") === adminToken) {
    return true
  }

  // Fallback: allow localhost even with token configured
  return isLocalRequest(req)
}

export function requireAuth(req: IncomingMessage): { ok: boolean; error?: string } {
  if (isAuthenticated(req)) return { ok: true }
  return { ok: false, error: "unauthorized" }
}
