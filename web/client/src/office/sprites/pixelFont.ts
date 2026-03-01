import type { SpriteData } from '../types.js'

// 3×5 bitmap font definition — each character is an array of 5 rows, each row is 3 bits
// 1 = filled pixel, 0 = transparent
const FONT: Record<string, number[]> = {
  A: [0b111, 0b101, 0b111, 0b101, 0b101],
  B: [0b110, 0b101, 0b110, 0b101, 0b110],
  C: [0b111, 0b100, 0b100, 0b100, 0b111],
  D: [0b110, 0b101, 0b101, 0b101, 0b110],
  E: [0b111, 0b100, 0b110, 0b100, 0b111],
  F: [0b111, 0b100, 0b110, 0b100, 0b100],
  G: [0b111, 0b100, 0b101, 0b101, 0b111],
  H: [0b101, 0b101, 0b111, 0b101, 0b101],
  I: [0b111, 0b010, 0b010, 0b010, 0b111],
  J: [0b001, 0b001, 0b001, 0b101, 0b111],
  K: [0b101, 0b101, 0b110, 0b101, 0b101],
  L: [0b100, 0b100, 0b100, 0b100, 0b111],
  M: [0b101, 0b111, 0b111, 0b101, 0b101],
  N: [0b101, 0b111, 0b111, 0b111, 0b101],
  O: [0b111, 0b101, 0b101, 0b101, 0b111],
  P: [0b111, 0b101, 0b111, 0b100, 0b100],
  Q: [0b111, 0b101, 0b101, 0b111, 0b001],
  R: [0b111, 0b101, 0b111, 0b110, 0b101],
  S: [0b111, 0b100, 0b111, 0b001, 0b111],
  T: [0b111, 0b010, 0b010, 0b010, 0b010],
  U: [0b101, 0b101, 0b101, 0b101, 0b111],
  V: [0b101, 0b101, 0b101, 0b101, 0b010],
  W: [0b101, 0b101, 0b111, 0b111, 0b101],
  X: [0b101, 0b101, 0b010, 0b101, 0b101],
  Y: [0b101, 0b101, 0b010, 0b010, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b001, 0b001, 0b001],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
  '.': [0b000, 0b000, 0b000, 0b000, 0b010],
  ',': [0b000, 0b000, 0b000, 0b010, 0b100],
  '!': [0b010, 0b010, 0b010, 0b000, 0b010],
  '?': [0b111, 0b001, 0b010, 0b000, 0b010],
  '-': [0b000, 0b000, 0b111, 0b000, 0b000],
  ':': [0b000, 0b010, 0b000, 0b010, 0b000],
  ' ': [0b000, 0b000, 0b000, 0b000, 0b000],
}

const CHAR_WIDTH = 3
const CHAR_HEIGHT = 5
const CHAR_SPACING = 1  // 1px gap between characters

/** 將文字渲染為 SpriteData（2D hex 陣列） */
export function renderPixelText(text: string, color = '#ffffff'): SpriteData {
  const upper = text.toUpperCase()
  const chars = [...upper]

  if (chars.length === 0) {
    // 空文字 → 1×1 透明
    return [['#00000000']]
  }

  const totalWidth = chars.length * (CHAR_WIDTH + CHAR_SPACING) - CHAR_SPACING
  const totalHeight = CHAR_HEIGHT

  // 建立透明畫布
  const sprite: SpriteData = Array.from({ length: totalHeight }, () =>
    Array.from({ length: totalWidth }, () => '#00000000'),
  )

  let xOffset = 0
  for (const ch of chars) {
    const glyph = FONT[ch]
    if (glyph) {
      for (let row = 0; row < CHAR_HEIGHT; row++) {
        for (let col = 0; col < CHAR_WIDTH; col++) {
          if (glyph[row] & (1 << (CHAR_WIDTH - 1 - col))) {
            sprite[row][xOffset + col] = color
          }
        }
      }
    }
    xOffset += CHAR_WIDTH + CHAR_SPACING
  }

  return sprite
}

/** 計算文字渲染後的像素寬度 */
export function getPixelTextWidth(text: string): number {
  const len = [...text].length
  return len > 0 ? len * (CHAR_WIDTH + CHAR_SPACING) - CHAR_SPACING : 1
}

/** 計算文字渲染後需要的格數寬度（向上取整至 TILE_SIZE） */
export function getPixelTextFootprintW(text: string, tileSize: number): number {
  return Math.max(1, Math.ceil(getPixelTextWidth(text) / tileSize))
}
