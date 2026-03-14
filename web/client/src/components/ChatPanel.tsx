import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { vscode } from '../socketApi.js'
import { t } from '../i18n.js'
import { CHAT_INPUT_MAX_LENGTH, CHAT_PANEL_MAX_MESSAGES } from '../constants.js'

export interface ChatMessage {
  nickname: string
  text: string
  ts: number
}

interface ChatPanelProps {
  messages: ChatMessage[]
}

/** 依據暱稱 hash 產生固定顏色 */
function nicknameColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  const hue = ((hash % 360) + 360) % 360
  return `hsl(${hue}, 70%, 70%)`
}

export const ChatPanel = memo(function ChatPanel({ messages }: ChatPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [inputText, setInputText] = useState('')
  const [hasNew, setHasNew] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const [sendHovered, setSendHovered] = useState(false)
  const [closeHovered, setCloseHovered] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevMsgCountRef = useRef(messages.length)

  // 新訊息到達時：展開則自動捲到底，收合則閃爍提示
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      if (expanded && listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight
      } else if (!expanded) {
        setHasNew(true)
      }
    }
    prevMsgCountRef.current = messages.length
  }, [messages.length, expanded])

  // 展開時捲到底部
  useEffect(() => {
    if (expanded && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
    if (expanded) setHasNew(false)
  }, [expanded])

  const handleSend = useCallback(() => {
    const text = inputText.trim()
    if (!text) return
    vscode.postMessage({ type: 'chatMessage', text })
    setInputText('')
  }, [inputText])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      handleSend()
    } else if (e.key === 'Escape') {
      inputRef.current?.blur()
      setExpanded(false)
    }
  }, [handleSend])

  const visibleMessages = messages.slice(-CHAT_PANEL_MAX_MESSAGES)
  const lastMsg = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1] : null

  return (
    <div
      className="pixel-chat-panel"
      style={{
        position: 'absolute',
        bottom: 50,
        right: 10,
        zIndex: 45,
        display: 'flex',
        flexDirection: 'column',
        width: 280,
      }}
    >
      {/* 收合時僅顯示最新訊息與切換按鈕 */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: 'var(--pixel-shadow)',
          }}
        >
          <span style={{ fontSize: '20px', color: 'var(--pixel-text)' }}>{t.chat}</span>
          {lastMsg && (
            <span
              style={{
                fontSize: '18px',
                color: 'rgba(255,255,255,0.5)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                textAlign: 'left',
              }}
            >
              <span style={{ color: nicknameColor(lastMsg.nickname) }}>{lastMsg.nickname}</span>: {lastMsg.text}
            </span>
          )}
          {hasNew && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--pixel-accent)',
                flexShrink: 0,
                animation: 'chatPulse 1s infinite',
              }}
            />
          )}
        </button>
      )}

      {/* 展開的聊天面板 */}
      {expanded && (
        <div
          style={{
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            boxShadow: 'var(--pixel-shadow)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 300,
          }}
        >
          {/* 標題列 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 8px',
              borderBottom: '1px solid var(--pixel-border)',
            }}
          >
            <span style={{ fontSize: '20px', color: 'rgba(255,255,255,0.9)' }}>{t.chat}</span>
            <button
              onClick={() => setExpanded(false)}
              onMouseEnter={() => setCloseHovered(true)}
              onMouseLeave={() => setCloseHovered(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: closeHovered ? 'var(--pixel-close-hover)' : 'rgba(255,255,255,0.6)',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '0 4px',
                lineHeight: 1,
              }}
            >
              X
            </button>
          </div>

          {/* 訊息列表 */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '4px 8px',
              minHeight: 100,
              maxHeight: 220,
            }}
          >
            {visibleMessages.map((msg, i) => {
              const d = new Date(msg.ts)
              const ts = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
              return (
                <div key={`${msg.ts}-${i}`} style={{ fontSize: '18px', marginBottom: 2, wordBreak: 'break-word' }}>
                  <span style={{ color: nicknameColor(msg.nickname), fontWeight: 'bold' }}>{msg.nickname}</span>
                  <span style={{ color: 'rgba(255,255,255,0.7)' }}>: {msg.text}</span>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '14px', marginLeft: 6 }}>{ts}</span>
                </div>
              )
            })}
            {visibleMessages.length === 0 && (
              <div style={{ fontSize: '18px', color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: 8 }}>
                ...
              </div>
            )}
          </div>

          {/* 輸入列 */}
          <div
            style={{
              display: 'flex',
              borderTop: '1px solid var(--pixel-border)',
              padding: 4,
              gap: 4,
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value.slice(0, CHAT_INPUT_MAX_LENGTH))}
              onKeyDown={handleKeyDown}
              onFocus={(e) => { e.stopPropagation(); setInputFocused(true) }}
              onBlur={() => setInputFocused(false)}
              placeholder={t.chatPlaceholder}
              maxLength={CHAT_INPUT_MAX_LENGTH}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.05)',
                border: `1px solid ${inputFocused ? 'var(--pixel-accent)' : 'var(--pixel-border)'}`,
                borderRadius: 0,
                color: 'var(--pixel-text)',
                fontSize: '18px',
                padding: '3px 6px',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleSend}
              onMouseEnter={() => setSendHovered(true)}
              onMouseLeave={() => setSendHovered(false)}
              style={{
                background: sendHovered ? 'var(--pixel-btn-hover-bg)' : 'var(--pixel-btn-bg)',
                border: '2px solid transparent',
                borderRadius: 0,
                color: 'var(--pixel-text)',
                fontSize: '18px',
                padding: '3px 8px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {t.chatSend}
            </button>
          </div>
          {/* 字數指示 */}
          {inputText.length > 0 && (
            <div style={{
              textAlign: 'right',
              padding: '0 8px 2px',
              fontSize: '14px',
              color: inputText.length > CHAT_INPUT_MAX_LENGTH * 0.8
                ? '#ef5b5b'
                : 'rgba(255,255,255,0.3)',
            }}>
              {inputText.length}/{CHAT_INPUT_MAX_LENGTH}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
