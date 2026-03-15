import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../i18n.js'

// ── 常數 ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'pixel-agents-guide-dismissed'

// ── 樣式 ─────────────────────────────────────────────────────────

const bannerStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 56,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 200,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-accent)',
  borderRadius: 0,
  padding: '6px 14px',
  boxShadow: 'var(--pixel-shadow)',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  whiteSpace: 'nowrap' as const,
  maxWidth: 'calc(100vw - 20px)',
}

const closeBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '16px',
  background: 'transparent',
  color: 'var(--pixel-close-text)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
  lineHeight: 1,
}

const loginBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '16px',
  background: 'var(--pixel-accent)',
  color: '#fff',
  border: '2px solid var(--pixel-accent)',
  borderRadius: 0,
  cursor: 'pointer',
  boxShadow: 'var(--pixel-shadow)',
}

// ── 工具函式 ─────────────────────────────────────────────────────

function isDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function saveDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true')
  } catch { /* 忽略 */ }
}

// ── 元件 ─────────────────────────────────────────────────────────

interface GuideBannerProps {
  /** 使用者是否已登入 */
  isAuthenticated: boolean
  /** 點擊「登入」按鈕的回呼（可選，若未提供則不顯示按鈕） */
  onLoginClick?: () => void
}

/**
 * 新手引導提示條 — 匿名訪客首次進入時顯示
 * 位於底部工具列上方，點擊 X 關閉並記憶至 localStorage
 * 登入後自動隱藏
 */
export function GuideBanner({ isAuthenticated, onLoginClick }: GuideBannerProps) {
  const [dismissed, setDismissed] = useState(isDismissed)

  const handleClose = useCallback(() => {
    setDismissed(true)
    saveDismissed()
  }, [])

  // 已登入或已關閉過則不顯示
  if (isAuthenticated || dismissed) return null

  return createPortal(
    <div
      style={bannerStyle}
      role="status"
      aria-label={t.guideBannerMessage}
    >
      <span style={{ fontSize: '18px', color: 'var(--pixel-text)' }}>
        {t.guideBannerMessage}
      </span>
      {onLoginClick && (
        <button
          style={loginBtnStyle}
          onClick={onLoginClick}
        >
          {t.login}
        </button>
      )}
      <button
        style={closeBtnStyle}
        onClick={handleClose}
        aria-label="Close"
      >
        {'\u2715'}
      </button>
    </div>,
    document.body,
  )
}
