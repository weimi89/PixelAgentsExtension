/** 將原始 model ID 格式化為簡短的顯示名稱，例如 "claude-opus-4-6" → "Opus" */
export function formatModelName(model: string): string {
  const m = model.match(/^claude-(\w+)/)
  if (m) {
    return m[1].charAt(0).toUpperCase() + m[1].slice(1)
  }
  return model.replace(/^claude-/, '')
}
