import { memo } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import type { SubagentCharacter } from '../hooks/useExtensionMessages.js'
import type { ConnectedNodeInfo } from '../types/messages.js'
import { isSittingState } from '../office/engine/characters.js'
import { useRenderTick } from '../hooks/useRenderTick.js'
import { computeCanvasMetrics } from '../office/components/canvasMetrics.js'

/** 信號強度小圖示 — 依延遲著色 */
function MiniSignalBars({ latencyMs }: { latencyMs: number }) {
  const color = latencyMs < 100 ? '#3794ff' : latencyMs < 300 ? '#cca700' : '#f44747'
  const bars = latencyMs < 100 ? 3 : latencyMs < 300 ? 2 : 1
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 1, height: 8 }}>
      {[1, 2, 3].map((level) => (
        <span
          key={level}
          style={{
            width: 2,
            height: 2 + level * 2,
            background: level <= bars ? color : 'rgba(255, 255, 255, 0.15)',
          }}
        />
      ))}
    </span>
  )
}

interface AgentLabelsProps {
  officeState: OfficeState
  agents: number[]
  agentStatuses: Record<number, string>
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  subagentCharacters: SubagentCharacter[]
  remoteAgents: Record<number, { owner: string }>
  nodeHealthNodes: ConnectedNodeInfo[]
}

export const AgentLabels = memo(function AgentLabels({
  officeState,
  agents,
  agentStatuses,
  containerRef,
  zoom,
  panRef,
  subagentCharacters,
  remoteAgents,
  nodeHealthNodes,
}: AgentLabelsProps) {
  useRenderTick()

  const el = containerRef.current
  if (!el) return null
  const layout = officeState.getLayout()
  const { deviceOffsetX, deviceOffsetY, dpr } = computeCanvasMetrics(el, layout.cols, layout.rows, zoom, panRef.current)

  const selectedId = officeState.selectedAgentId

  // 所有需要渲染標籤的角色 ID（一般代理 + 子代理）
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)]

  // 建構 owner → latencyMs 查找表
  const ownerLatencyMap = new Map<string, number>()
  for (const node of nodeHealthNodes) {
    ownerLatencyMap.set(node.username, node.latencyMs)
  }

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id)
        if (!ch) return null

        // 當非斷線的對話氣泡顯示時隱藏（讓氣泡單獨可見）
        if (ch.bubbleType && ch.bubbleType !== 'detached') return null
        // 選取時由 AgentDetailPanel 負責顯示完整資訊，此處不重複渲染
        if (selectedId === id) return null

        const status = agentStatuses[id]
        const isWaiting = status === 'waiting'
        const isActive = ch.isActive
        const isDetached = ch.isDetached

        // 檢查是否為遠端代理
        const remoteInfo = remoteAgents[id]
        const latencyMs = remoteInfo ? ownerLatencyMap.get(remoteInfo.owner) : undefined

        let dotColor: string | null = null
        if (isDetached) {
          dotColor = 'var(--pixel-status-detached)'
        } else if (isWaiting) {
          dotColor = '#cca700'
        } else if (isActive) {
          dotColor = '#3794ff'
        }

        // 遠端代理即使無狀態圓點也可能需要顯示信號強度
        const hasSignal = remoteInfo && latencyMs !== undefined
        // 無狀態圓點且無信號 → 不渲染
        if (!dotColor && !hasSignal) return null
        // 有表情顯示時隱藏（表情已經傳達狀態資訊）
        if (ch.emoteType) return null

        // 精簡圓點位於角色頭頂上方（坐姿與站姿使用不同偏移）
        const isSitting = isSittingState(ch.state)
        const dotOffsetY = isSitting ? (14 - 42) : -34
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + dotOffsetY) * zoom) / dpr

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 40,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {dotColor && (
              <span
                className={isActive && !isWaiting ? 'pixel-agents-pulse' : undefined}
                style={{
                  display: 'block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: dotColor,
                }}
              />
            )}
            {hasSignal && <MiniSignalBars latencyMs={latencyMs} />}
          </div>
        )
      })}
    </>
  )
})
