import pptxgenjs from "pptxgenjs"
const pptxgen = (pptxgenjs as any).default ?? pptxgenjs

type RouteRequest = { body?: any }
type RouteResponse = {
  json?: (data: any) => void
  setHeader?: (k: string, v: string) => void
  send?: (data: any) => void
  status?: (code: number) => RouteResponse
  end?: () => void
}

const THEMES: Record<string, { bg: string; accent: string; text: string; sub: string }> = {
  midnight_executive: { bg: "1E2761", accent: "CADCFC", text: "FFFFFF", sub: "CADCFC" },
  coral_energy:       { bg: "F96167", accent: "F9E795", text: "FFFFFF", sub: "2F3C7E" },
  charcoal_minimal:   { bg: "36454F", accent: "F2F2F2", text: "FFFFFF", sub: "AAAAAA" },
  teal_trust:         { bg: "028090", accent: "02C39A", text: "FFFFFF", sub: "E0F7FA" },
  forest_moss:        { bg: "2C5F2D", accent: "97BC62", text: "FFFFFF", sub: "E8F5E9" }
}

function getTheme(name?: string) {
  return THEMES[name ?? "midnight_executive"] ?? THEMES["midnight_executive"]
}

function safeStr(v: any): string {
  return String(v ?? "").trim()
}

function safeBullets(v: any): string[] {
  if (!Array.isArray(v)) return []
  return v.map((b: any) => safeStr(b)).filter(Boolean)
}

export async function runSlidesGenerateRoute(req: RouteRequest, res: RouteResponse) {
  const body = req?.body ?? {}
  console.log("[SLIDES] body keys:", Object.keys(body ?? {}))
  const slideData = body?.slide_data ?? body
  console.log("[SLIDES] slideData title:", slideData?.title, "slides count:", slideData?.slides?.length)

  console.error("[SLIDES] Invalid structure:", JSON.stringify(slideData).slice(0, 200))
  if (!slideData?.slides || !Array.isArray(slideData.slides)) {
    res.status?.(400).json?.({ ok: false, error: "slide_data.slides is required" })
    return
  }

  const theme = getTheme(slideData?.theme)
  const prs = new pptxgen()

  prs.layout = "LAYOUT_WIDE"
  prs.author  = "AI Orchestra"
  prs.title   = safeStr(slideData.title) || "AI Orchestra Presentation"

  const W = 13.33
  const H = 7.5

  for (const slide of slideData.slides) {
    const sld = prs.addSlide()
    const type = safeStr(slide?.type) || "content"

    // ── title slide ──────────────────────────────────────────
    if (type === "title") {
      // 배경
      sld.addShape(prs.ShapeType.rect, {
        x: 0, y: 0, w: W, h: H,
        fill: { color: theme.bg }
      })
      // 좌측 액센트 바
      sld.addShape(prs.ShapeType.rect, {
        x: 0, y: 0, w: 0.12, h: H,
        fill: { color: theme.accent }
      })
      // 제목
      sld.addText(safeStr(slide.title) || "Presentation", {
        x: 0.8, y: 2.0, w: W - 1.6, h: 1.8,
        fontSize: 44, bold: true,
        color: theme.text,
        fontFace: "Calibri",
        align: "left", valign: "middle"
      })
      // 부제목
      if (slide.subtitle) {
        sld.addText(safeStr(slide.subtitle), {
          x: 0.8, y: 3.9, w: W - 1.6, h: 0.8,
          fontSize: 20, bold: false,
          color: theme.sub,
          fontFace: "Calibri",
          align: "left"
        })
      }
    }

    // ── content slide ────────────────────────────────────────
    else if (type === "content") {
      // 헤더 바
      sld.addShape(prs.ShapeType.rect, {
        x: 0, y: 0, w: W, h: 1.1,
        fill: { color: theme.bg }
      })
      sld.addText(safeStr(slide.title), {
        x: 0.4, y: 0, w: W - 0.8, h: 1.1,
        fontSize: 28, bold: true,
        color: theme.text,
        fontFace: "Calibri",
        align: "left", valign: "middle"
      })
      // 불릿
      const bullets = safeBullets(slide.bullets)
      if (bullets.length > 0) {
        const bulletObjs = bullets.map((b: string) => ({
          text: b,
          options: { bullet: { type: "bullet" as any }, fontSize: 18, color: "333333", breakLine: true, paraSpaceAfter: 10 }
        }))
        sld.addText(bulletObjs as any, {
          x: 0.5, y: 1.4, w: W - 1.0, h: H - 1.9,
          fontFace: "Calibri",
          valign: "top"
        })
      }
    }

    // ── two_column slide ─────────────────────────────────────
    else if (type === "two_column") {
      sld.addShape(prs.ShapeType.rect, {
        x: 0, y: 0, w: W, h: 1.1,
        fill: { color: theme.bg }
      })
      sld.addText(safeStr(slide.title), {
        x: 0.4, y: 0, w: W - 0.8, h: 1.1,
        fontSize: 28, bold: true,
        color: theme.text,
        fontFace: "Calibri",
        align: "left", valign: "middle"
      })

      const colW = (W - 1.2) / 2
      const left  = slide.left  ?? {}
      const right = slide.right ?? {}

      for (const [col, xOff] of [[left, 0.4], [right, colW + 0.8]] as [any, number][]) {
        if (col.heading) {
          sld.addText(safeStr(col.heading), {
            x: xOff, y: 1.3, w: colW, h: 0.5,
            fontSize: 16, bold: true,
            color: theme.bg,
            fontFace: "Calibri"
          })
        }
        const colBullets = safeBullets(col.bullets)
        if (colBullets.length > 0) {
          const bulletObjs = colBullets.map((b: string) => ({
            text: b,
            options: { bullet: { type: "bullet" as any }, fontSize: 16, color: "444444", breakLine: true, paraSpaceAfter: 8 }
          }))
          sld.addText(bulletObjs as any, {
            x: xOff, y: 1.9, w: colW, h: H - 2.4,
            fontFace: "Calibri", valign: "top"
          })
        }
      }

      // 중앙 구분선
      sld.addShape(prs.ShapeType.rect, {
        x: colW + 0.6, y: 1.2, w: 0.02, h: H - 1.5,
        fill: { color: "DDDDDD" }
      })
    }

    // ── closing slide ────────────────────────────────────────
    else if (type === "closing") {
      sld.addShape(prs.ShapeType.rect, {
        x: 0, y: 0, w: W, h: H,
        fill: { color: theme.bg }
      })
      sld.addShape(prs.ShapeType.rect, {
        x: 0, y: 0, w: W, h: 0.12,
        fill: { color: theme.accent }
      })
      sld.addText(safeStr(slide.title) || "Thank You", {
        x: 0.8, y: 2.2, w: W - 1.6, h: 1.4,
        fontSize: 44, bold: true,
        color: theme.text,
        fontFace: "Calibri",
        align: "center", valign: "middle"
      })
      if (slide.subtitle) {
        sld.addText(safeStr(slide.subtitle), {
          x: 0.8, y: 3.8, w: W - 1.6, h: 0.8,
          fontSize: 20,
          color: theme.sub,
          fontFace: "Calibri",
          align: "center"
        })
      }
    }
  }

  // PPTX → Buffer → 다운로드
  console.log("[SLIDES] Generating PPTX...")
  const buf = await prs.write({ outputType: "nodebuffer" }) as Buffer
  console.log("[SLIDES] PPTX generated, size:", (buf as any).length)

  const filename = "presentation.pptx"

  res.setHeader?.("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
  res.setHeader?.("Content-Disposition", `attachment; filename="${filename}"`)
  res.send?.(buf)
}

export const slidesRoutes = [
  {
    method: "post" as const,
    path: "/api/slides/generate",
    handler: runSlidesGenerateRoute
  }
]
