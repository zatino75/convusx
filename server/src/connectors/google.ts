/**
 * google.ts — Google APIs 커넥터 (Drive / Sheets / Calendar / Gmail)
 *
 * 인증: Service Account JWT (RS256) → access_token 교환.
 * 환경변수 GOOGLE_SERVICE_ACCOUNT_JSON (전체 JSON 문자열) 사용.
 * 미설정/형식오류 시 모든 함수가 null 반환 (서비스 중단 방지).
 *
 * 코드베이스 일관성 유지를 위해 googleapis npm 패키지 대신 직접 REST 호출.
 * (다른 커넥터 — serper/notion/naverNews — 와 동일 패턴)
 *
 * 함수:
 *  - searchDriveFiles(query)
 *  - readSheetData(spreadsheetId, range)
 *  - listCalendarEvents(calendarId, days?)
 *  - searchGmailThreads(query)
 *  - callGoogle(query) — DepartmentAgent 사전조사 어댑터 (Drive 검색)
 */

import crypto from "node:crypto"

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const FETCH_TIMEOUT_MS = 12_000
const TOKEN_TTL_MS = 50 * 60 * 1000 // 50분 (실제 1시간 만료, 여유 10분)

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ")

interface ServiceAccount {
  client_email: string
  private_key: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

function getServiceAccount(): ServiceAccount | null {
  const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim()
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (!obj?.client_email || !obj?.private_key) return null
    return {
      client_email: String(obj.client_email),
      private_key: String(obj.private_key).replace(/\\n/g, "\n"),
    }
  } catch {
    return null
  }
}

function base64Url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}

function buildSignedJwt(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = base64Url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPES,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    }),
  )
  const signingInput = `${header}.${payload}`
  const signer = crypto.createSign("RSA-SHA256")
  signer.update(signingInput)
  const signature = base64Url(signer.sign(sa.private_key))
  return `${signingInput}.${signature}`
}

async function getAccessToken(): Promise<string | null> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token

  const sa = getServiceAccount()
  if (!sa) return null

  let jwt: string
  try {
    jwt = buildSignedJwt(sa)
  } catch {
    return null
  }

  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }).toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    const token = String(data?.access_token ?? "")
    if (!token) return null
    cachedToken = { token, expiresAt: now + TOKEN_TTL_MS }
    return token
  } catch {
    return null
  }
}

async function googleFetch(url: string): Promise<any | null> {
  const token = await getAccessToken()
  if (!token) return null
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ─── Drive ─────────────────────────────────────────────────────────
export interface DriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink: string
  modifiedTime: string
}

export async function searchDriveFiles(query: string): Promise<DriveFile[] | null> {
  const q = String(query ?? "").trim()
  if (!q) return []
  const driveQuery = `name contains '${q.replace(/'/g, "\\'")}' and trashed = false`
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(driveQuery)}&fields=files(id,name,mimeType,webViewLink,modifiedTime)&pageSize=20`
  const data = await googleFetch(url)
  if (!data) return null
  const files = Array.isArray(data?.files) ? data.files : []
  return files.map((f: any) => ({
    id: String(f?.id ?? ""),
    name: String(f?.name ?? ""),
    mimeType: String(f?.mimeType ?? ""),
    webViewLink: String(f?.webViewLink ?? ""),
    modifiedTime: String(f?.modifiedTime ?? ""),
  }))
}

// ─── Sheets ────────────────────────────────────────────────────────
export async function readSheetData(spreadsheetId: string, range: string): Promise<any[][] | null> {
  const id = encodeURIComponent(String(spreadsheetId ?? ""))
  const r = encodeURIComponent(String(range ?? ""))
  if (!id || !r) return null
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${r}`
  const data = await googleFetch(url)
  if (!data) return null
  return Array.isArray(data?.values) ? data.values : []
}

// ─── Calendar ──────────────────────────────────────────────────────
export interface CalendarEvent {
  id: string
  summary: string
  start: string
  end: string
  htmlLink: string
}

export async function listCalendarEvents(calendarId = "primary", days = 7): Promise<CalendarEvent[] | null> {
  const id = encodeURIComponent(String(calendarId ?? "primary"))
  const timeMin = new Date().toISOString()
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const url = `https://www.googleapis.com/calendar/v3/calendars/${id}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=50`
  const data = await googleFetch(url)
  if (!data) return null
  const items = Array.isArray(data?.items) ? data.items : []
  return items.map((it: any) => ({
    id: String(it?.id ?? ""),
    summary: String(it?.summary ?? "(제목 없음)"),
    start: String(it?.start?.dateTime ?? it?.start?.date ?? ""),
    end: String(it?.end?.dateTime ?? it?.end?.date ?? ""),
    htmlLink: String(it?.htmlLink ?? ""),
  }))
}

// ─── Gmail ─────────────────────────────────────────────────────────
export interface GmailThread {
  id: string
  snippet: string
  historyId: string
}

export async function searchGmailThreads(query: string): Promise<GmailThread[] | null> {
  const q = String(query ?? "").trim()
  if (!q) return []
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(q)}&maxResults=20`
  const data = await googleFetch(url)
  if (!data) return null
  const threads = Array.isArray(data?.threads) ? data.threads : []
  return threads.map((t: any) => ({
    id: String(t?.id ?? ""),
    snippet: String(t?.snippet ?? ""),
    historyId: String(t?.historyId ?? ""),
  }))
}

/** 사전 조사 파이프라인용 어댑터 — Drive 검색을 기본으로 한다. */
export async function callGoogle(query: string): Promise<string> {
  if (!getServiceAccount()) return "[Google: GOOGLE_SERVICE_ACCOUNT_JSON 없음 — 비활성]"
  const files = await searchDriveFiles(query)
  if (!files) return "[Google Drive: 검색 실패]"
  if (files.length === 0) return "[Google Drive: 결과 없음]"
  const lines = files.map((f, i) => {
    const date = f.modifiedTime ? ` (${f.modifiedTime.slice(0, 10)})` : ""
    return `${i + 1}. **${f.name}** [${f.mimeType}]${date}\n   ${f.webViewLink}`
  })
  return `**Google Drive 파일 (${files.length}건)**\n${lines.join("\n")}`
}
