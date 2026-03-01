import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { t } from '../i18n.js'

interface TerminalTab {
  agentId: number
  label: string
  terminal: Terminal
  fitAddon: FitAddon
  ws: WebSocket | null
  status: 'connecting' | 'connected' | 'error' | 'closed'
  errorMessage?: string
}

interface TerminalPanelProps {
  /** 開啟的終端分頁列表：agentId + 顯示名稱 */
  tabs: Array<{ agentId: number; label: string }>
  /** 目前選取的分頁代理 ID */
  activeTabId: number | null
  /** 切換分頁 */
  onSelectTab: (agentId: number) => void
  /** 關閉單一分頁 */
  onCloseTab: (agentId: number) => void
  /** 關閉整個面板 */
  onClosePanel: () => void
}

const TERMINAL_THEME = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#1e1e2e',
  selectionBackground: '#45475a',
  selectionForeground: '#cdd6f4',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
}

const MIN_PANEL_HEIGHT = 150
const DEFAULT_PANEL_HEIGHT = 300
const MAX_PANEL_HEIGHT_RATIO = 0.7

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/terminal-ws`
}

export function TerminalPanel({ tabs, activeTabId, onSelectTab, onCloseTab, onClosePanel }: TerminalPanelProps) {
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT)
  const termContainerRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<Map<number, TerminalTab>>(new Map())
  const resizingRef = useRef(false)
  const [, forceRender] = useState(0)

  // 建立或取得 TerminalTab 實例
  const getOrCreateTab = useCallback((agentId: number, label: string): TerminalTab => {
    const existing = tabsRef.current.get(agentId)
    if (existing) return existing

    const terminal = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: '"FS Pixel Sans", monospace',
      fontSize: 14,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: true,
      scrollback: 5000,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    const wsUrl = getWsUrl()
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'

    const tab: TerminalTab = {
      agentId,
      label,
      terminal,
      fitAddon,
      ws,
      status: 'connecting',
    }

    ws.onopen = () => {
      // 傳送 attach 命令
      const cols = terminal.cols || 80
      const rows = terminal.rows || 24
      ws.send(JSON.stringify({ type: 'attach', agentId, cols, rows }))
    }

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        // JSON 控制訊息
        try {
          const msg = JSON.parse(event.data) as { type: string; message?: string; code?: number }
          if (msg.type === 'attached') {
            tab.status = 'connected'
            forceRender((n) => n + 1)
          } else if (msg.type === 'error') {
            tab.status = 'error'
            tab.errorMessage = msg.message || t.terminalError
            terminal.writeln(`\r\n\x1b[31m${tab.errorMessage}\x1b[0m`)
            forceRender((n) => n + 1)
          } else if (msg.type === 'exit') {
            tab.status = 'closed'
            terminal.writeln(`\r\n\x1b[33m${t.terminalExited}\x1b[0m`)
            forceRender((n) => n + 1)
          } else if (msg.type === 'detached') {
            tab.status = 'closed'
            forceRender((n) => n + 1)
          }
        } catch { /* ignore malformed JSON */ }
      } else {
        // 二進位終端輸出
        const text = new TextDecoder().decode(event.data as ArrayBuffer)
        terminal.write(text)
      }
    }

    ws.onerror = () => {
      tab.status = 'error'
      tab.errorMessage = t.terminalConnectionError
      terminal.writeln(`\r\n\x1b[31m${t.terminalConnectionError}\x1b[0m`)
      forceRender((n) => n + 1)
    }

    ws.onclose = () => {
      if (tab.status === 'connecting' || tab.status === 'connected') {
        tab.status = 'closed'
        terminal.writeln(`\r\n\x1b[33m${t.terminalDisconnected}\x1b[0m`)
        forceRender((n) => n + 1)
      }
    }

    // 終端輸入 → WebSocket
    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // 終端大小變更 → WebSocket
    terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    tabsRef.current.set(agentId, tab)
    return tab
  }, [])

  // 清理已移除的 tab
  const cleanupTab = useCallback((agentId: number) => {
    const tab = tabsRef.current.get(agentId)
    if (tab) {
      if (tab.ws && tab.ws.readyState <= WebSocket.OPEN) {
        tab.ws.close()
      }
      tab.terminal.dispose()
      tabsRef.current.delete(agentId)
    }
  }, [])

  // 同步 tabs prop 與內部狀態
  useEffect(() => {
    const currentIds = new Set(tabs.map((t) => t.agentId))
    // 清理已移除的 tabs
    for (const id of tabsRef.current.keys()) {
      if (!currentIds.has(id)) {
        cleanupTab(id)
      }
    }
    // 建立新 tabs
    for (const { agentId, label } of tabs) {
      getOrCreateTab(agentId, label)
    }
  }, [tabs, getOrCreateTab, cleanupTab])

  // 掛載/切換 active terminal 到容器
  useEffect(() => {
    const container = termContainerRef.current
    if (!container || activeTabId == null) return

    // 清除容器中的舊內容
    while (container.firstChild) {
      container.removeChild(container.firstChild)
    }

    const tab = tabsRef.current.get(activeTabId)
    if (!tab) return

    // 開啟 terminal 到容器
    tab.terminal.open(container)
    // 稍延遲 fit 以確保容器尺寸已確定
    requestAnimationFrame(() => {
      try { tab.fitAddon.fit() } catch { /* ignore */ }
      tab.terminal.focus()
    })
  }, [activeTabId])

  // 面板高度變更時重新 fit
  useEffect(() => {
    if (activeTabId == null) return
    const tab = tabsRef.current.get(activeTabId)
    if (!tab) return
    const timer = setTimeout(() => {
      try { tab.fitAddon.fit() } catch { /* ignore */ }
    }, 50)
    return () => clearTimeout(timer)
  }, [panelHeight, activeTabId])

  // 視窗大小變更時重新 fit
  useEffect(() => {
    const handler = () => {
      if (activeTabId == null) return
      const tab = tabsRef.current.get(activeTabId)
      if (tab) {
        try { tab.fitAddon.fit() } catch { /* ignore */ }
      }
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [activeTabId])

  // 組件卸載時清理所有 tabs
  useEffect(() => {
    return () => {
      for (const id of tabsRef.current.keys()) {
        cleanupTab(id)
      }
    }
  }, [cleanupTab])

  // 拖曳調整面板高度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    const startY = e.clientY
    const startHeight = panelHeight

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = startY - ev.clientY
      const maxH = window.innerHeight * MAX_PANEL_HEIGHT_RATIO
      const newHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(maxH, startHeight + delta))
      setPanelHeight(newHeight)
    }
    const onMouseUp = () => {
      resizingRef.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [panelHeight])

  if (tabs.length === 0) return null

  const activeTab = activeTabId != null ? tabsRef.current.get(activeTabId) : null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: panelHeight,
        zIndex: 'var(--pixel-controls-z)' as unknown as number,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--pixel-bg)',
        borderTop: '2px solid var(--pixel-border)',
      }}
    >
      {/* 拖曳調整把手 */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          height: 4,
          cursor: 'ns-resize',
          background: 'transparent',
          flexShrink: 0,
        }}
      />

      {/* 標題列 + 分頁 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          padding: '0 4px',
          borderBottom: '2px solid var(--pixel-border)',
          flexShrink: 0,
          height: 30,
          overflow: 'hidden',
        }}
      >
        <span style={{ fontSize: '20px', color: 'var(--pixel-accent)', marginRight: 8, flexShrink: 0 }}>
          {t.terminal}
        </span>

        {/* 分頁 */}
        <div style={{ display: 'flex', gap: 2, flex: 1, overflow: 'hidden' }}>
          {tabs.map(({ agentId, label }) => {
            const isActive = agentId === activeTabId
            const tab = tabsRef.current.get(agentId)
            const statusColor =
              tab?.status === 'connected' ? 'var(--pixel-status-active)' :
              tab?.status === 'error' ? 'var(--pixel-status-permission)' :
              tab?.status === 'connecting' ? 'var(--pixel-status-waiting)' :
              'var(--pixel-text-dim)'
            return (
              <div
                key={agentId}
                onClick={() => onSelectTab(agentId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontSize: '18px',
                  background: isActive ? 'var(--pixel-selected-bg)' : 'transparent',
                  color: isActive ? 'var(--pixel-text)' : 'var(--pixel-text-dim)',
                  border: isActive ? '1px solid var(--pixel-border)' : '1px solid transparent',
                  borderBottom: isActive ? '1px solid var(--pixel-bg)' : '1px solid transparent',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                <span>{label}</span>
                <span
                  onClick={(e) => { e.stopPropagation(); onCloseTab(agentId) }}
                  style={{
                    cursor: 'pointer',
                    color: 'var(--pixel-text-dim)',
                    marginLeft: 2,
                  }}
                  title={t.terminalCloseTab}
                >
                  x
                </span>
              </div>
            )
          })}
        </div>

        {/* 關閉面板按鈕 */}
        <button
          onClick={onClosePanel}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pixel-text-dim)',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '0 4px',
            flexShrink: 0,
          }}
          title={t.terminalClosePanel}
        >
          x
        </button>
      </div>

      {/* 終端區域 */}
      <div
        ref={termContainerRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
        }}
      />

      {/* 無活躍分頁時的空狀態 */}
      {activeTab == null && tabs.length > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--pixel-text-dim)',
            fontSize: '20px',
          }}
        >
          {t.terminalSelectTab}
        </div>
      )}
    </div>
  )
}
