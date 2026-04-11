// toolBootstrap.ts — auto-import all tools to trigger registerTool() side effects.
//
// MUST be imported ONCE from the top-level entry (src/index.ts). Separated from
// toolRegistry.ts to break the ESM circular import that caused TDZ on the
// `registry` binding:
//
//   toolRegistry.ts  ←→  tools/*.ts
//        │ top-level `import "./tools/..."`
//        │ tools/*.ts top-level `import { registerTool } from "../toolRegistry.js"`
//        │ → ESM hoists both sides → tools evaluate before toolRegistry body
//        │ → `registry = new Map()` still in TDZ → ReferenceError on registerTool
//
// Fix: toolRegistry.ts no longer imports tools. Only toolBootstrap does.
// index.ts imports toolBootstrap before anything that uses the registry.
//
// DO NOT remove this file. DO NOT move the imports back into toolRegistry.ts.
// (2026-04-11, deployment to /opt/corvusx on gabia Ubuntu 22.04)

// Phase 2 — 최소 세트 (attachment / thread history / perplexity)
import "./tools/readAttachment.js"
import "./tools/recallThreadHistory.js"

// Phase 4-C — 프로젝트 메모리 회상 + 소스 승격
import "./tools/recallProjectMemory.js"
import "./tools/promoteToSource.js"
import "./tools/perplexitySearch.js"

// Phase 3 — 병렬 앙상블 / 적대적 비평 / 개별 draft
import "./tools/gptDraft.js"
import "./tools/geminiDraft.js"
import "./tools/claudeDraftAlt.js"
import "./tools/parallelEnsemble.js"
import "./tools/adversarialCritique.js"

// Phase 4 — 도메인 특화 도구 (식품/액상전자담배/화장품/범용)
import "./tools/domain/food/marketAnalyze.js"
import "./tools/domain/food/equipmentSearch.js"
import "./tools/domain/food/regulationCheck.js"
import "./tools/domain/food/recipeDesign.js"
import "./tools/domain/food/brandRetail.js"
import "./tools/domain/ecig/marketAnalyze.js"
import "./tools/domain/ecig/competitorScan.js"
import "./tools/domain/ecig/regulationCheck.js"
import "./tools/domain/ecig/brandRetail.js"
import "./tools/domain/cosmetic/marketAnalyze.js"
import "./tools/domain/cosmetic/competitorScan.js"
import "./tools/domain/cosmetic/recipeDesign.js"
import "./tools/domain/cosmetic/manufacturingCheck.js"
import "./tools/domain/general/marketAnalyze.js"
import "./tools/domain/general/businessAnalyze.js"
import "./tools/domain/general/financeAnalyze.js"

// Phase 5 — 웹 페이지 전체 콘텐츠 조회 (URL → 텍스트)
import "./tools/webFetch.js"

// Phase 6 — 이미지/비디오 생성 (DALL-E 3 / Midjourney v7 / Imagen 4 / Flash / Runway / Veo 3.1)
import "./tools/generateImage.js"
import "./tools/generateVideo.js"
