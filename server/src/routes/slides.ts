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

const THEMES: Record<string, { bg: string; accent: string; text: string; sub: string; card: string }> = {
  midnight_executive: { bg: "1E2761", accent: "CADCFC", text: "FFFFFF", sub: "CADCFC", card: "2A3575" },
  coral_energy:       { bg: "F96167", accent: "F9E795", text: "FFFFFF", sub: "2F3C7E", card: "E04F55" },
  charcoal_minimal:   { bg: "36454F", accent: "F2F2F2", text: "FFFFFF", sub: "AAAAAA", card: "465560" },
  teal_trust:         { bg: "028090", accent: "02C39A", text: "FFFFFF", sub: "E0F7FA", card: "039AAC" },
  forest_moss:        { bg: "2C5F2D", accent: "97BC62", text: "FFFFFF", sub: "E8F5E9", card: "3A7A3B" },
  corvus_dark:        { bg: "0F0F1A", accent: "6366F1", text: "FFFFFF", sub: "94A3B8", card: "1E1E35" },
  white_clean:        { bg: "FFFFFF", accent: "6366F1", text: "1E293B", sub: "64748B", card: "F1F5F9" },
}

function getTheme(name?: string) {
  return THEMES[name ?? "midnight_executive"] ?? THEMES["midnight_executive"]
}
function safeStr(v: any): string { return String(v ?? "").trim() }
function safeBullets(v: any): string[] {
  if (!Array.isArray(v)) return []
  return v.map((b: any) => safeStr(b)).filter(Boolean)
}
function safeRows(v: any): string[][] {
  if (!Array.isArray(v)) return []
  return v.map((row: any) => Array.isArray(row) ? row.map(safeStr) : [])
}
function addSlideNumber(sld: any, _prs: any, num: number, total: number, theme: any) {
  sld.addText(`${num} / ${total}`, {
    x: 12.6, y: 7.1, w: 0.7, h: 0.3,
    fontSize: 9, color: theme.sub, fontFace: "Calibri", align: "right"
  })
}

export async function runSlidesGenerateRoute(req: RouteRequest, res: RouteResponse) {
  const body = req?.body ?? {}
  const slideData = body?.slide_data ?? body

  if (!slideData?.slides || !Array.isArray(slideData.slides) || slideData.slides.length === 0) {
    res.status?.(400).json?.({ ok: false, error: "slide_data.slides is required and must be non-empty" })
    return
  }

  const theme = getTheme(slideData?.theme)
  const showPageNumbers = slideData?.page_numbers !== false
  const prs = new pptxgen()
  prs.layout  = "LAYOUT_WIDE"
  prs.author  = "CORVUS X"
  prs.company = "CORVUS X"
  prs.title   = safeStr(slideData.title) || "CORVUS X Presentation"

  const W = 13.33
  const H = 7.5
  const total = slideData.slides.length

  for (let idx = 0; idx < total; idx++) {
    const slide = slideData.slides[idx]
    const sld = prs.addSlide()
    const type = safeStr(slide?.type) || "content"
    const num = idx + 1
    if (slide?.notes) sld.addNotes(safeStr(slide.notes))

    if (type === "title") {
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: theme.bg } })
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: H, fill: { color: theme.accent } })
      sld.addText(safeStr(slide.title) || "Presentation", {
        x: 0.8, y: 1.8, w: W - 1.6, h: 2.0,
        fontSize: 44, bold: true, color: theme.text, fontFace: "Calibri", align: "left", valign: "middle"
      })
      if (slide.subtitle) sld.addText(safeStr(slide.subtitle), { x: 0.8, y: 3.9, w: W - 1.6, h: 0.8, fontSize: 20, color: theme.sub, fontFace: "Calibri", align: "left" })
      if (slide.date) sld.addText(safeStr(slide.date), { x: 0.8, y: 6.8, w: 4, h: 0.4, fontSize: 12, color: theme.sub, fontFace: "Calibri" })

    } else if (type === "section_header") {
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: theme.bg } })
      sld.addShape(prs.ShapeType.rect, { x: 0, y: H / 2 - 0.06, w: W, h: 0.12, fill: { color: theme.accent } })
      sld.addText(safeStr(slide.title), { x: 0.8, y: 2.3, w: W - 1.6, h: 1.4, fontSize: 36, bold: true, color: theme.text, fontFace: "Calibri", align: "center", valign: "middle" })
      if (slide.subtitle) sld.addText(safeStr(slide.subtitle), { x: 0.8, y: 4.0, w: W - 1.6, h: 0.7, fontSize: 18, color: theme.sub, fontFace: "Calibri", align: "center" })
      if (showPageNumbers) addSlideNumber(sld, prs, num, total, theme)

    } else if (type === "content") {
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: W, h: 1.1, fill: { color: theme.bg } })
      sld.addText(safeStr(slide.title), { x: 0.4, y: 0, w: W - 0.8, h: 1.1, fontSize: 28, bold: true, color: theme.text, fontFace: "Calibri", align: "left", valign: "middle" })
      const bullets = safeBullets(slide.bullets)
      const bodyText = safeStr(slide.body)
      if (bullets.length > 0) {
        const bulletObjs = bullets.map((b: string) => ({ text: b, options: { bullet: { type: "bullet" as any }, fontSize: 18, color: "333333", breakLine: true, paraSpaceAfter: 10 } }))
        sld.addText(bulletObjs as any, { x: 0.5, y: 1.35, w: W - 1.0, h: H - 1.85, fontFace: "Calibri", valign: "top" })
      } else if (bodyText) {
        sld.addText(bodyText, { x: 0.5, y: 1.35, w: W - 1.0, h: H - 1.85, fontSize: 18, color: "333333", fontFace: "Calibri", valign: "top", wrap: true })
      }
      if (showPageNumbers) addSlideNumber(sld, prs, num, total, theme)

    } else if (type === "two_column") {
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: W, h: 1.1, fill: { color: theme.bg } })
      sld.addText(safeStr(slide.title), { x: 0.4, y: 0, w: W - 0.8, h: 1.1, fontSize: 28, bold: true, color: theme.text, fontFace: "Calibri", align: "left", valign: "middle" })
      const colW = (W - 1.2) / 2
      for (const [col, xOff] of [[slide.left ?? {}, 0.4], [slide.right ?? {}, colW + 0.8]] as [any, number][]) {
        if (col.heading) sld.addText(safeStr(col.heading), { x: xOff, y: 1.3, w: colW, h: 0.5, fontSize: 16, bold: true, color: theme.bg, fontFace: "Calibri" })
        const colBullets = safeBullets(col.bullets)
        const colBody = safeStr(col.body)
        const yStart = col.heading ? 1.9 : 1.4
        const hAvail = H - yStart - 0.5
        if (colBullets.length > 0) {
          const bulletObjs = colBullets.map((b: string) => ({ text: b, options: { bullet: { type: "bullet" as any }, fontSize: 16, color: "444444", breakLine: true, paraSpaceAfter: 8 } }))
          sld.addText(bulletObjs as any, { x: xOff, y: yStart, w: colW, h: hAvail, fontFace: "Calibri", valign: "top" })
        } else if (colBody) {
          sld.addText(colBody, { x: xOff, y: yStart, w: colW, h: hAvail, fontSize: 16, color: "444444", fontFace: "Calibri", valign: "top", wrap: true })
        }
      }
      sld.addShape(prs.ShapeType.rect, { x: colW + 0.6, y: 1.2, w: 0.02, h: H - 1.5, fill: { color: "DDDDDD" } })
      if (showPageNumbers) addSlideNumber(sld, prs, num, total, theme)

    } else if (type === "stats") {
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: W, h: 1.1, fill: { color: theme.bg } })
      sld.addText(safeStr(slide.title), { x: 0.4, y: 0, w: W - 0.8, h: 1.1, fontSize: 28, bold: true, color: theme.text, fontFace: "Calibri", align: "left", valign: "middle" })
      const stats = Array.isArray(slide.stats) ? slide.stats : []
      const count = Math.min(stats.length, 4)
      if (count > 0) {
        const cardW = (W - 0.8) / count - 0.2
        for (let i = 0; i < count; i++) {
          const stat = stats[i]
          const xPos = 0.4 + i * (cardW + 0.2)
          sld.addShape(prs.ShapeType.rect, { x: xPos, y: 1.4, w: cardW, h: 4.2, fill: { color: theme.card }, line: { color: theme.accent, width: 1 } })
          sld.addText(safeStr(stat.value), { x: xPos + 0.1, y: 2.0, w: cardW - 0.2, h: 1.6, fontSize: 48, bold: true, color: theme.accent, fontFace: "Calibri", align: "center", valign: "middle" })
          sld.addText(safeStr(stat.label), { x: xPos + 0.1, y: 3.7, w: cardW - 0.2, h: 0.6, fontSize: 14, color: theme.text, fontFace: "Calibri", align: "center" })
          if (stat.sub) sld.addText(safeStr(stat.sub), { x: xPos + 0.1, y: 4.4, w: cardW - 0.2, h: 0.8, fontSize: 11, color: theme.sub, fontFace: "Calibri", align: "center", wrap: true })
        }
      }
      if (showPageNumbers) addSlideNumber(sld, prs, num, total, theme)

    } else if (type === "quote") {
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: theme.bg } })
      sld.addShape(prs.ShapeType.rect, { x: 0.6, y: 1.5, w: 0.08, h: 4.2, fill: { color: theme.accent } })
      sld.addText(safeStr(slide.quote) || safeStr(slide.title), { x: 1.0, y: 1.6, w: W - 2.0, h: 3.5, fontSize: 26, color: theme.text, fontFace: "Calibri", align: "left", valign: "middle", italic: true, wrap: true })
      if (slide.author) sld.addText(`— ${safeStr(slide.author)}`, { x: 1.0, y: 5.4, w: W - 2.0, h: 0.5, fontSize: 14, color: theme.sub, fontFace: "Calibri", align: "right" })
      if (showPageNumbers) addSlideNumber(sld, prs, num, total, theme)

    } else if (type === "table") {
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: W, h: 1.1, fill: { color: theme.bg } })
      sld.addText(safeStr(slide.title), { x: 0.4, y: 0, w: W - 0.8, h: 1.1, fontSize: 28, bold: true, color: theme.text, fontFace: "Calibri", align: "left", valign: "middle" })
      const headers: string[] = Array.isArray(slide.headers) ? slide.headers.map(safeStr) : []
      const rows = safeRows(slide.rows)
      if (headers.length > 0 || rows.length > 0) {
        const tableData: any[] = []
        if (headers.length > 0) tableData.push(headers.map(h => ({ text: h, options: { bold: true, color: "FFFFFF", fill: { color: theme.bg }, fontSize: 13, fontFace: "Calibri" } })))
        rows.forEach((row, ri) => tableData.push(row.map(cell => ({ text: cell, options: { fontSize: 12, fontFace: "Calibri", color: "333333", fill: { color: ri % 2 === 0 ? "F8F9FA" : "FFFFFF" } } }))))
        sld.addTable(tableData, { x: 0.4, y: 1.3, w: W - 0.8, border: { type: "solid", color: "DDDDDD", pt: 0.5 }, rowH: 0.4 })
      }
      if (showPageNumbers) addSlideNumber(sld, prs, num, total, theme)

    } else if (type === "closing") {
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: theme.bg } })
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: theme.accent } })
      sld.addShape(prs.ShapeType.rect, { x: 0, y: H - 0.12, w: W, h: 0.12, fill: { color: theme.accent } })
      sld.addText(safeStr(slide.title) || "Thank You", { x: 0.8, y: 2.0, w: W - 1.6, h: 1.6, fontSize: 44, bold: true, color: theme.text, fontFace: "Calibri", align: "center", valign: "middle" })
      if (slide.subtitle) sld.addText(safeStr(slide.subtitle), { x: 0.8, y: 3.8, w: W - 1.6, h: 0.8, fontSize: 20, color: theme.sub, fontFace: "Calibri", align: "center" })
      if (slide.contact) sld.addText(safeStr(slide.contact), { x: 0.8, y: 5.8, w: W - 1.6, h: 0.5, fontSize: 14, color: theme.sub, fontFace: "Calibri", align: "center" })

    } else {
      // fallback: content
      sld.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: W, h: 1.1, fill: { color: theme.bg } })
      sld.addText(safeStr(slide.title), { x: 0.4, y: 0, w: W - 0.8, h: 1.1, fontSize: 28, bold: true, color: theme.text, fontFace: "Calibri", align: "left", valign: "middle" })
      const bullets = safeBullets(slide.bullets)
      const bodyText = safeStr(slide.body)
      if (bullets.length > 0) {
        const bulletObjs = bullets.map((b: string) => ({ text: b, options: { bullet: { type: "bullet" as any }, fontSize: 18, color: "333333", breakLine: true, paraSpaceAfter: 10 } }))
        sld.addText(bulletObjs as any, { x: 0.5, y: 1.35, w: W - 1.0, h: H - 1.85, fontFace: "Calibri", valign: "top" })
      } else if (bodyText) {
        sld.addText(bodyText, { x: 0.5, y: 1.35, w: W - 1.0, h: H - 1.85, fontSize: 18, color: "333333", fontFace: "Calibri", valign: "top", wrap: true })
      }
      if (showPageNumbers) addSlideNumber(sld, prs, num, total, theme)
    }
  }

  const buf = await prs.write({ outputType: "nodebuffer" }) as Buffer
  const filename = encodeURIComponent(safeStr(slideData.title) || "presentation") + ".pptx"
  res.setHeader?.("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
  res.setHeader?.("Content-Disposition", `attachment; filename="${filename}"`)
  res.send?.(buf)
}

export const slidesRoutes = [
  { method: "post" as const, path: "/api/slides/generate", handler: runSlidesGenerateRoute }
]
