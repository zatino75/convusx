export type VisionAttachment = {
  name?: string
  type?: string
  base64?: string
}

export function isVisionAttachment(file?: VisionAttachment) {
  const mime = String(file?.type ?? "").toLowerCase()
  return mime.startsWith("image/") || mime.startsWith("video/")
}

export function buildVisionPrompt(file?: VisionAttachment, userMessage?: string) {
  return {
    task: "vision",
    prompt: [
      `[VISION INPUT]`,
      `name: ${String(file?.name ?? "")}`,
      `type: ${String(file?.type ?? "")}`,
      "",
      String(userMessage ?? "").trim(),
    ].join("\n").trim(),
  }
}
