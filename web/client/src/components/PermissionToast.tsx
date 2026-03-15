import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// ── 樣式常數 ─────────────────────────────────────────────────────

const TOAST_DURATION_MS = 3000
const FADE_DURATION_MS = 300

const toastStyle: React.CSSProperties = {
  position: 'fixed',
  top: 80,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 400,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-status-permission)',
  borderRadius: 0,
  padding: '8px 16px',
  boxShadow: 'var(--pixel-shadow)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  whiteSpace: 'nowrap' as const,
  pointerEvents: 'none' as const,
}

// ── 元件 ─────────────────────────────────────────────────────────

interface PermissionToastProps {
  /** 要顯示的訊息文字，null 或空字串表示不顯示 */
  message: string | null
  /** 訊息消失後的回呼 */
  onDismiss: () => void
}

/**
 * 權限不足友善提示 — 像素風格 toast 通知
 * 從頂部中央彈出，3 秒後自動淡出消失
 */
export function PermissionToast({ message, onDismiss }: PermissionToastProps) {
  const [opacity, setOpacity] = useState(1)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!message) {
      setVisible(false)
      return
    }

    // 顯示 toast
    setOpacity(1)
    setVisible(true)

    // 設定自動消失計時器
    const fadeTimer = setTimeout(() => {
      setOpacity(0)
    }, TOAST_DURATION_MS)

    // 淡出完成後隱藏並通知父元件
    const dismissTimer = setTimeout(() => {
      setVisible(false)
      onDismiss()
    }, TOAST_DURATION_MS + FADE_DURATION_MS)

    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(dismissTimer)
    }
  }, [message, onDismiss])

  if (!visible || !message) return null

  return createPortal(
    <div
      style={{
        ...toastStyle,
        opacity,
        transition: `opacity ${FADE_DURATION_MS}ms ease-out`,
      }}
      role="alert"
      aria-live="polite"
    >
      {/* 鎖頭圖示 */}
      <span style={{ fontSize: '18px', color: 'var(--pixel-status-permission)' }}>
        {'\u{1F512}'}
      </span>
      <span style={{ fontSize: '18px', color: 'var(--pixel-text)' }}>
        {message}
      </span>
    </div>,
    document.body,
  )
}
