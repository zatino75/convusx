/**
 * CORVUS X — Plugin/Extension System (B5)
 *
 * 플러그인 아키텍처:
 *  - 플러그인은 manifest (JSON) + 핸들러 함수로 구성
 *  - 생명주기: register → activate → deactivate → unregister
 *  - Hook 시스템: pre/post 미들웨어 패턴
 *
 * 지원 Hook 포인트:
 *  - beforeChat    — 채팅 요청 전처리
 *  - afterChat     — 채팅 응답 후처리
 *  - beforeSend    — Provider API 호출 전
 *  - afterSend     — Provider API 응답 후
 *  - onError       — 에러 발생 시
 *  - onBenchmark   — 벤치마크 완료 시
 *  - onStartup     — 서버 시작 시
 *  - onShutdown    — 서버 종료 시
 */

import { logger } from "../observability/logger.js"

// ── 타입 ──

export type HookName =
  | "beforeChat"
  | "afterChat"
  | "beforeSend"
  | "afterSend"
  | "onError"
  | "onBenchmark"
  | "onStartup"
  | "onShutdown"

export interface PluginManifest {
  /** 플러그인 고유 ID (예: "corvus-plugin-translator") */
  id: string
  /** 표시 이름 */
  name: string
  /** 버전 */
  version: string
  /** 설명 */
  description: string
  /** 작성자 */
  author?: string
  /** 이 플러그인이 등록할 Hook 이름 목록 */
  hooks: HookName[]
}

export type HookHandler = (context: HookContext) => Promise<HookContext> | HookContext

export interface HookContext {
  /** Hook 이름 */
  hook: HookName
  /** 전달 데이터 (각 Hook마다 구조 상이) */
  data: Record<string, unknown>
  /** Hook 체인 중단 여부 */
  abort?: boolean
  /** 중단 사유 */
  abortReason?: string
}

export interface Plugin {
  manifest: PluginManifest
  handlers: Partial<Record<HookName, HookHandler>>
  active: boolean
}

// ── 플러그인 레지스트리 ──

const plugins = new Map<string, Plugin>()

// ── 등록 / 해제 ──

export function registerPlugin(manifest: PluginManifest, handlers: Partial<Record<HookName, HookHandler>>): boolean {
  if (plugins.has(manifest.id)) {
    logger.warn(`[Plugin] already registered: ${manifest.id}`)
    return false
  }

  // manifest 검증
  if (!manifest.id || !manifest.name || !manifest.version) {
    logger.error("[Plugin] invalid manifest — id, name, version required")
    return false
  }

  // 선언된 Hook에 대한 핸들러 존재 여부 확인
  for (const hook of manifest.hooks) {
    if (!handlers[hook]) {
      logger.warn(`[Plugin] ${manifest.id} declares hook "${hook}" but no handler provided`)
    }
  }

  plugins.set(manifest.id, { manifest, handlers, active: false })
  logger.info(`[Plugin] registered: ${manifest.id} v${manifest.version}`)
  return true
}

export function unregisterPlugin(pluginId: string): boolean {
  const plugin = plugins.get(pluginId)
  if (!plugin) return false

  if (plugin.active) deactivatePlugin(pluginId)
  plugins.delete(pluginId)
  logger.info(`[Plugin] unregistered: ${pluginId}`)
  return true
}

// ── 활성화 / 비활성화 ──

export function activatePlugin(pluginId: string): boolean {
  const plugin = plugins.get(pluginId)
  if (!plugin) return false
  if (plugin.active) return true

  plugin.active = true
  logger.info(`[Plugin] activated: ${pluginId}`)
  return true
}

export function deactivatePlugin(pluginId: string): boolean {
  const plugin = plugins.get(pluginId)
  if (!plugin) return false
  if (!plugin.active) return true

  plugin.active = false
  logger.info(`[Plugin] deactivated: ${pluginId}`)
  return true
}

// ── Hook 실행 ──

export async function executeHook(hookName: HookName, initialData: Record<string, unknown>): Promise<HookContext> {
  let context: HookContext = { hook: hookName, data: initialData }

  for (const [_id, plugin] of plugins) {
    if (!plugin.active) continue
    const handler = plugin.handlers[hookName]
    if (!handler) continue

    try {
      context = await handler(context)
      if (context.abort) {
        logger.info(`[Plugin] hook "${hookName}" aborted by ${plugin.manifest.id}`, {
          reason: context.abortReason
        })
        break
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      logger.error(`[Plugin] hook "${hookName}" error in ${plugin.manifest.id}`, { error: errMsg })
      // 개별 플러그인 에러는 체인을 중단하지 않음
    }
  }

  return context
}

// ── 조회 ──

export function getPluginList(): Array<{
  id: string
  name: string
  version: string
  description: string
  active: boolean
  hooks: HookName[]
}> {
  return Array.from(plugins.values()).map(p => ({
    id: p.manifest.id,
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    active: p.active,
    hooks: p.manifest.hooks,
  }))
}

export function getPlugin(pluginId: string): Plugin | undefined {
  return plugins.get(pluginId)
}

export function isPluginActive(pluginId: string): boolean {
  return plugins.get(pluginId)?.active ?? false
}

// ── 초기화 / 정리 ──

export async function initPlugins() {
  // onStartup Hook 실행
  await executeHook("onStartup", { timestamp: new Date().toISOString() })
  logger.info(`[Plugin] system initialized — ${plugins.size} plugins registered`)
}

export async function shutdownPlugins() {
  await executeHook("onShutdown", { timestamp: new Date().toISOString() })
  for (const [id] of plugins) {
    deactivatePlugin(id)
  }
  logger.info("[Plugin] all plugins deactivated")
}
