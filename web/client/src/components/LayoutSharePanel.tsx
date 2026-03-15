import { useState, useRef, useEffect, memo } from 'react'
import { vscode, onServerMessage } from '../socketApi.js'
import { t } from '../i18n.js'

interface LayoutSharePanelProps {
  isOpen: boolean
  onClose: () => void
}

export const LayoutSharePanel = memo(function LayoutSharePanel({ isOpen, onClose }: LayoutSharePanelProps) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true))
    } else {
      setVisible(false)
    }
  }, [isOpen])

  // Escape 鍵關閉
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // 監聽匯出回傳 — 複製到剪貼簿
  const pendingCopyRef = useRef(false)
  useEffect(() => {
    const unsub = onServerMessage((data) => {
      const msg = data as Record<string, unknown>
      if (msg.type === 'exportLayoutData' && msg.layout && pendingCopyRef.current) {
        pendingCopyRef.current = false
        const json = JSON.stringify(msg.layout, null, 2)
        navigator.clipboard.writeText(json).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }).catch((err) => {
          console.error('Copy to clipboard failed:', err)
        })
      }
    })
    return unsub
  }, [])

  if (!isOpen) return null

  const handleCopy = () => {
    pendingCopyRef.current = true
    vscode.postMessage({ type: 'requestExportLayout' })
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const imported = JSON.parse(text) as Record<string, unknown>
      if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
        console.error(t.invalidLayoutFile)
        return
      }
      vscode.postMessage({ type: 'saveLayout', layout: imported })
      onClose()
    } catch {
      console.error(t.parseLayoutFailed)
    }
  }

  const handleExport = () => {
    vscode.postMessage({ type: 'requestExportLayout' })
  }

  const handleImport = () => {
    importInputRef.current?.click()
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string) as Record<string, unknown>
        if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
          console.error(t.invalidLayoutFile)
          return
        }
        vscode.postMessage({ type: 'saveLayout', layout: imported })
      } catch {
        console.error(t.parseLayoutFailed)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
    onClose()
  }

  const menuItemStyle = (key: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '8px 12px',
    fontSize: '22px',
    color: 'var(--pixel-text)',
    background: hovered === key ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
    border: 'none',
    borderRadius: 0,
    cursor: 'pointer',
    textAlign: 'left',
  })

  return (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
      {/* 背景遮罩 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 59,
        }}
      />
      {/* 面板 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.shareLayout}
        className="pixel-modal-dialog"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: visible ? 'translate(-50%, -50%)' : 'translate(-50%, -40%)',
          opacity: visible ? 1 : 0,
          transition: 'transform 0.2s ease-out, opacity 0.2s ease-out',
          zIndex: 60,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 220,
        }}
      >
        {/* 標題 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 10px',
          borderBottom: '1px solid var(--pixel-border)',
          marginBottom: 4,
        }}>
          <span style={{ fontSize: '22px', color: 'var(--pixel-text)' }}>
            {t.shareLayout}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'var(--pixel-close-text)',
              fontSize: '22px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>

        {/* 動作按鈕 */}
        <button
          onClick={handleCopy}
          onMouseEnter={() => setHovered('copy')}
          onMouseLeave={() => setHovered(null)}
          style={menuItemStyle('copy')}
        >
          {copied ? t.copied : t.copyToClipboard}
          {copied && <span style={{ color: 'var(--pixel-green)' }}>{'\u2713'}</span>}
        </button>

        <button
          onClick={handlePaste}
          onMouseEnter={() => setHovered('paste')}
          onMouseLeave={() => setHovered(null)}
          style={menuItemStyle('paste')}
        >
          {t.pasteFromClipboard}
        </button>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '4px 0' }} />

        <button
          onClick={handleExport}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={menuItemStyle('export')}
        >
          {t.exportLayout}
        </button>

        <button
          onClick={handleImport}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={menuItemStyle('import')}
        >
          {t.importLayout}
        </button>
      </div>
    </>
  )
})
