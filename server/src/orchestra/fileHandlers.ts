export type AttachedFile = {
  name: string
  type: string
  size?: number
  base64?: string
}

function ext(name: string) {
  const value = String(name ?? "")
  const idx = value.lastIndexOf(".")
  return idx >= 0 ? value.slice(idx + 1).toLowerCase() : ""
}

export function detectFileTask(file?: AttachedFile) {
  const extension = ext(file?.name ?? "")
  if (["xlsx", "xls", "csv"].includes(extension)) return "excel"
  if (["doc", "docx"].includes(extension)) return "word"
  if (["pdf"].includes(extension)) return "pdf"
  if (["ppt", "pptx"].includes(extension)) return "ppt"
  return "attachment"
}

export function buildFileAnalysisPrompt(file?: AttachedFile, userMessage?: string) {
  const fileTask = detectFileTask(file)
  return {
    task: fileTask,
    prompt: [
      `[FILE ANALYSIS]`,
      `name: ${String(file?.name ?? "")}`,
      `type: ${String(file?.type ?? "")}`,
      `size: ${Number(file?.size ?? 0)}`,
      "",
      String(userMessage ?? "").trim(),
    ].join("\n").trim(),
  }
}
