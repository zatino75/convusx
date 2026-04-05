export function apiUrl(path: string): string {
  const base = String((import.meta as any).env?.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "")
  if (!base) return path
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}
