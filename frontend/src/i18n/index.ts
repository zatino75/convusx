import ko from "./ko.json"
import en from "./en.json"

type LangKey = "ko" | "en"
const translations: Record<LangKey, Record<string, any>> = { ko, en }

let currentLang: LangKey = "ko"

export function setLanguage(lang: LangKey) {
  currentLang = lang
}

export function getLanguage(): LangKey {
  return currentLang
}

export function t(key: string, fallback?: string): string {
  const keys = key.split(".")
  let value: any = translations[currentLang]
  for (const k of keys) {
    value = value?.[k]
    if (value === undefined) break
  }
  if (typeof value === "string") return value

  // Fallback to Korean
  let fallbackValue: any = translations.ko
  for (const k of keys) {
    fallbackValue = fallbackValue?.[k]
    if (fallbackValue === undefined) break
  }
  if (typeof fallbackValue === "string") return fallbackValue

  return fallback ?? key
}

// Initialize from environment
const envLang = typeof import.meta !== "undefined" ? (import.meta as any).env?.VITE_LANG : undefined
if (envLang === "en") setLanguage("en")
