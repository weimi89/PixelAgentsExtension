import { useState, useCallback, useRef, useEffect } from 'react'
import { OfficeState } from './office/engine/officeState.js'
import { OfficeCanvas } from './office/components/OfficeCanvas.js'
import { ToolOverlay } from './office/components/ToolOverlay.js'
import { EditorToolbar } from './office/editor/EditorToolbar.js'
import { EditorState } from './office/editor/editorState.js'
import { EditTool } from './office/types.js'
import { isRotatable } from './office/layout/furnitureCatalog.js'
import { vscode, onServerMessage, onConnectionChange, isConnected } from './socketApi.js'
import { useExtensionMessages } from './hooks/useExtensionMessages.js'
import { useEditorActions } from './hooks/useEditorActions.js'
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js'
import { ZoomControls } from './components/ZoomControls.js'
import { BottomToolbar } from './components/BottomToolbar.js'
import { DebugView } from './components/DebugView.js'
import { AgentLabels } from './components/AgentLabels.js'
import { SessionPicker } from './components/SessionPicker.js'
import { BuildingView } from './components/BuildingView.js'
import { ChatPanel } from './components/ChatPanel.js'
import { AgentDetailPanel } from './components/AgentDetailPanel.js'
import { ContextMenu } from './components/ContextMenu.js'
import type { ContextMenuAction } from './components/ContextMenu.js'
import { TerminalPanel } from './components/TerminalPanel.js'
import { Dashboard } from './pages/Dashboard.js'
import type { SessionInfo } from './components/SessionPicker.js'
import type { ServerMessage } from './types/messages.js'
import { t } from './i18n.js'

// 遊戲狀態存在於 React 之外 — 由訊息處理器以命令式方式更新
const officeStateRef = { current: null as OfficeState | null }
const editorState = new EditorState()

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState()
  }
  return officeStateRef.current
}

const actionBarBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '22px',
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const actionBarBtnDisabled: React.CSSProperties = {
  ...actionBarBtnStyle,
  opacity: 'var(--pixel-btn-disabled-opacity)',
  cursor: 'default',
}

function EditActionBar({ editor, editorState: es }: { editor: ReturnType<typeof useEditorActions>; editorState: EditorState }) {
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const undoDisabled = es.undoStack.length === 0
  const redoDisabled = es.redoStack.length === 0

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--pixel-controls-z)',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: '4px 8px',
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      <button
        style={undoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={undoDisabled ? undefined : editor.handleUndo}
        title={t.undoShortcut}
      >
        {t.undo}
      </button>
      <button
        style={redoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={redoDisabled ? undefined : editor.handleRedo}
        title={t.redoShortcut}
      >
        {t.redo}
      </button>
      <button
        style={actionBarBtnStyle}
        onClick={editor.handleSave}
        title={t.saveLayout}
      >
        {t.save}
      </button>
      {!showResetConfirm ? (
        <button
          style={actionBarBtnStyle}
          onClick={() => setShowResetConfirm(true)}
          title={t.resetToLastSaved}
        >
          {t.reset}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '22px', color: 'var(--pixel-reset-text)' }}>{t.resetConfirm}</span>
          <button
            style={{ ...actionBarBtnStyle, background: 'var(--pixel-danger-bg)', color: '#fff' }}
            onClick={() => { setShowResetConfirm(false); editor.handleReset() }}
          >
            {t.yes}
          </button>
          <button
            style={actionBarBtnStyle}
            onClick={() => setShowResetConfirm(false)}
          >
            {t.no}
          </button>
        </div>
      )}
    </div>
  )
}

function App() {
  const editor = useEditorActions(getOfficeState, editorState)

  const isEditDirty = useCallback(() => editor.isEditMode && editor.isDirty, [editor.isEditMode, editor.isDirty])

  const handleUiScaleLoaded = useCallback((scale: number) => setUiScale(scale), [])
  const { agents, selectedAgent, agentTools, agentStatuses, agentModels, subagentTools, subagentCharacters, layoutReady, loadedAssets, agentProjects, remoteAgents, agentTranscripts, projectDirs, currentFloorId, building, floorSummaries, chatMessages, agentGitBranches, agentStatusHistory, agentTeams, agentCliTypes, lanPeers } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty, editor.handleZoomChange, handleUiScaleLoaded)

  const [uiScale, setUiScale] = useState(1)
  const [isDebugMode, setIsDebugMode] = useState(false)
  const [isBuildingViewOpen, setIsBuildingViewOpen] = useState(false)
  const [dayNightEnabled, setDayNightEnabled] = useState(true)
  const [dayNightTimeOverride, setDayNightTimeOverride] = useState<number | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSessionPickerOpen, setIsSessionPickerOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [connected, setConnected] = useState(isConnected)
  const [contextMenu, setContextMenu] = useState<{ agentId: number; x: number; y: number } | null>(null)
  const [isDashboardView, setIsDashboardView] = useState(false)
  const [detailPanelAgentId, setDetailPanelAgentId] = useState<number | null>(null)
  const [terminalTabs, setTerminalTabs] = useState<Array<{ agentId: number; label: string }>>([])
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<number | null>(null)

  useEffect(() => {
    return onConnectionChange(setConnected)
  }, [])

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), [])

  // 關閉所有底部工具列面板（互斥：同時只能開一個）
  const closeAllPanels = useCallback(() => {
    setIsSettingsOpen(false)
    setIsSessionPickerOpen(false)
    setIsBuildingViewOpen(false)
    setIsDashboardView(false)
    if (editor.isEditMode) editor.handleToggleEditMode()
  }, [editor.isEditMode, editor.handleToggleEditMode])

  // 進入佈局編輯時，只關閉其他面板（不遞迴觸發 edit mode toggle）
  const handleToggleEditModeExclusive = useCallback(() => {
    if (!editor.isEditMode) {
      setIsSettingsOpen(false)
      setIsSessionPickerOpen(false)
      setIsBuildingViewOpen(false)
      setIsDashboardView(false)
    }
    editor.handleToggleEditMode()
  }, [editor.isEditMode, editor.handleToggleEditMode])

  const handleToggleBuildingView = useCallback(() => {
    if (isBuildingViewOpen) {
      setIsBuildingViewOpen(false)
    } else {
      closeAllPanels()
      setIsBuildingViewOpen(true)
    }
  }, [isBuildingViewOpen, closeAllPanels])

  const handleSwitchFloor = useCallback((floorId: string) => {
    vscode.postMessage({ type: 'switchFloor', floorId })
  }, [])

  const handleOpenSessionPicker = useCallback(() => {
    closeAllPanels()
    setIsSessionPickerOpen(true)
    setIsLoadingSessions(true)
    vscode.postMessage({ type: 'listSessions' })
    vscode.postMessage({ type: 'listProjectDirs' })
  }, [closeAllPanels])

  const handleToggleSettings = useCallback(() => {
    if (isSettingsOpen) {
      setIsSettingsOpen(false)
    } else {
      closeAllPanels()
      setIsSettingsOpen(true)
    }
  }, [isSettingsOpen, closeAllPanels])

  const handleResumeSession = useCallback((sessionId: string, projectDir: string) => {
    vscode.postMessage({ type: 'resumeSession', sessionId, projectDir })
    setIsSessionPickerOpen(false)
  }, [])

  const handleExcludeProject = useCallback((dirBasename: string) => {
    vscode.postMessage({ type: 'excludeProject', projectDir: dirBasename })
    // 重新獲取 sessions 和目錄清單以反映排除
    vscode.postMessage({ type: 'listSessions' })
    vscode.postMessage({ type: 'listProjectDirs' })
  }, [])

  const handleIncludeProject = useCallback((dirBasename: string) => {
    vscode.postMessage({ type: 'includeProject', projectDir: dirBasename })
    // 重新獲取 sessions 和目錄清單以反映恢復
    vscode.postMessage({ type: 'listSessions' })
    vscode.postMessage({ type: 'listProjectDirs' })
  }, [])

  useEffect(() => {
    const unsub = onServerMessage((data) => {
      const msg = data as ServerMessage
      if (msg.type === 'sessionsList') {
        setSessions(msg.sessions)
        setIsLoadingSessions(false)
      }
    })
    return unsub
  }, [])

  const handleSelectAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'focusAgent', id })
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0)
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    handleToggleEditModeExclusive,
  )

  const handleToggleDashboardView = useCallback(() => {
    if (isDashboardView) {
      setIsDashboardView(false)
    } else {
      closeAllPanels()
      setIsDashboardView(true)
    }
  }, [isDashboardView, closeAllPanels])
  const handleUiScaleChange = useCallback((scale: number) => {
    setUiScale(scale)
    vscode.postMessage({ type: 'setUiScale', scale })
  }, [])
  const handleToggleDayNight = useCallback(() => setDayNightEnabled((v) => !v), [])
  const handleDayNightTimeOverrideChange = useCallback((h: number | null) => setDayNightTimeOverride(h), [])

  const handleCloseAgent = useCallback((id: number) => {
    vscode.postMessage({ type: 'closeAgent', id })
  }, [])

  const handleCloseDetailPanel = useCallback(() => {
    setDetailPanelAgentId(null)
  }, [])

  const handleOpenTerminal = useCallback((agentId: number) => {
    const label = agentProjects[agentId] || t.agent(agentId)
    setTerminalTabs((prev) => {
      if (prev.some((tab) => tab.agentId === agentId)) return prev
      return [...prev, { agentId, label }]
    })
    setActiveTerminalTabId(agentId)
  }, [agentProjects])

  const handleCloseTerminalTab = useCallback((agentId: number) => {
    setTerminalTabs((prev) => prev.filter((tab) => tab.agentId !== agentId))
    setActiveTerminalTabId((prev) => {
      if (prev !== agentId) return prev
      // 切換到下一個分頁或 null
      const remaining = terminalTabs.filter((tab) => tab.agentId !== agentId)
      return remaining.length > 0 ? remaining[remaining.length - 1].agentId : null
    })
  }, [terminalTabs])

  const handleCloseTerminalPanel = useCallback(() => {
    setTerminalTabs([])
    setActiveTerminalTabId(null)
  }, [])

  const handleContextMenu = useCallback((agentId: number, x: number, y: number) => {
    setContextMenu({ agentId, x, y })
  }, [])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleClick = useCallback((agentId: number) => {
    // 若點擊的是子代理，改為聚焦父代理的終端
    const os = getOfficeState()
    const meta = os.subagentMeta.get(agentId)
    const focusId = meta ? meta.parentAgentId : agentId
    vscode.postMessage({ type: 'focusAgent', id: focusId })
    // 切換代理詳情面板（點擊同一代理則關閉，不同代理則切換）
    setDetailPanelAgentId((prev) => prev === focusId ? null : focusId)
  }, [])

  // Space 鍵關閉選取代理的氣泡（非編輯模式）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editor.isEditMode) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === ' ') {
        e.preventDefault()
        const os = getOfficeState()
        const selId = os.selectedAgentId
        if (selId != null) {
          os.dismissBubble(selId)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editor.isEditMode])

  const officeState = getOfficeState()

  // 強制依賴 editorTickForKeyboard 以傳播鍵盤觸發的重新渲染
  void editorTickForKeyboard

  // 當選取或正在放置可旋轉的物件時顯示「按 R 旋轉」提示
  const showRotateHint = editor.isEditMode && (() => {
    if (editorState.selectedFurnitureUid) {
      const item = officeState.getLayout().furniture.find((f) => f.uid === editorState.selectedFurnitureUid)
      if (item && isRotatable(item.type)) return true
    }
    if (editorState.activeTool === EditTool.FURNITURE_PLACE && isRotatable(editorState.selectedFurnitureType)) {
      return true
    }
    return false
  })()

  if (!layoutReady) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--pixel-text)' }}>
        {t.loading}
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', '--pixel-ui-scale': uiScale } as React.CSSProperties}>
      {isDashboardView ? (
        <Dashboard />
      ) : (
      <div style={{
        opacity: layoutReady ? 1 : 0,
        transition: 'opacity 0.2s ease-in-out',
        width: '100%',
        height: '100%',
      }}>
        <OfficeCanvas
          officeState={officeState}
          onClick={handleClick}
          isEditMode={editor.isEditMode}
          editorState={editorState}
          onEditorTileAction={editor.handleEditorTileAction}
          onEditorEraseAction={editor.handleEditorEraseAction}
          onEditorSelectionChange={editor.handleEditorSelectionChange}
          onDeleteSelected={editor.handleDeleteSelected}
          onRotateSelected={editor.handleRotateSelected}
          onDragMove={editor.handleDragMove}
          editorTick={editor.editorTick}
          zoom={editor.zoom}
          onZoomChange={editor.handleZoomChange}
          panRef={editor.panRef}
          dayNightEnabled={dayNightEnabled}
          dayNightTimeOverride={dayNightTimeOverride}
          onContextMenu={handleContextMenu}
        />
      </div>
      )}

      {!isDashboardView && <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />}

      {/* 斷線指示器 */}
      {!connected && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 80,
            zIndex: 'var(--pixel-controls-z)',
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-status-permission)',
            borderRadius: 0,
            padding: '4px 10px',
            boxShadow: 'var(--pixel-shadow)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--pixel-status-permission)',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '20px', color: 'var(--pixel-status-permission)' }}>
            {t.disconnected}
          </span>
        </div>
      )}

      {/* 暈影覆蓋層 */}
      {!isDashboardView && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--pixel-vignette)',
            pointerEvents: 'none',
            zIndex: 40,
          }}
        />
      )}

      <BottomToolbar
        isEditMode={editor.isEditMode}
        onToggleEditMode={handleToggleEditModeExclusive}
        onOpenSessionPicker={handleOpenSessionPicker}
        isDebugMode={isDebugMode}
        onToggleDebugMode={handleToggleDebugMode}
        floors={building?.floors ?? []}
        currentFloorId={currentFloorId}
        onSwitchFloor={handleSwitchFloor}
        isBuildingViewOpen={isBuildingViewOpen}
        onToggleBuildingView={handleToggleBuildingView}
        dayNightEnabled={dayNightEnabled}
        onToggleDayNight={handleToggleDayNight}
        dayNightTimeOverride={dayNightTimeOverride}
        onDayNightTimeOverrideChange={handleDayNightTimeOverrideChange}
        isDashboardView={isDashboardView}
        onToggleDashboardView={handleToggleDashboardView}
        uiScale={uiScale}
        onUiScaleChange={handleUiScaleChange}
        lanPeers={lanPeers}
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={handleToggleSettings}
      />

      <SessionPicker
        isOpen={isSessionPickerOpen}
        onClose={() => setIsSessionPickerOpen(false)}
        sessions={sessions}
        onResume={handleResumeSession}
        isLoading={isLoadingSessions}
        projectDirs={projectDirs}
        onExcludeProject={handleExcludeProject}
        onIncludeProject={handleIncludeProject}
      />

      <BuildingView
        isOpen={isBuildingViewOpen}
        onClose={() => setIsBuildingViewOpen(false)}
        floors={building?.floors ?? []}
        currentFloorId={currentFloorId}
        floorSummaries={floorSummaries}
        onSwitchFloor={handleSwitchFloor}
      />

      <ChatPanel messages={chatMessages} />

      {!isDashboardView && detailPanelAgentId != null && agents.includes(detailPanelAgentId) && (() => {
        // 組合代理資訊供面板使用
        const agentInfoMap: Record<number, { projectName?: string; isRemote?: boolean; owner?: string }> = {}
        for (const id of agents) {
          agentInfoMap[id] = {
            projectName: agentProjects[id],
            isRemote: !!remoteAgents[id],
            owner: remoteAgents[id]?.owner,
          }
        }
        return (
          <AgentDetailPanel
            agentId={detailPanelAgentId}
            agents={agentInfoMap}
            agentStatuses={agentStatuses}
            agentTools={agentTools}
            agentModels={agentModels}
            agentGitBranches={agentGitBranches}
            agentStatusHistory={agentStatusHistory}
            onClose={handleCloseDetailPanel}
          />
        )
      })()}

      {!isDashboardView && editor.isEditMode && editor.isDirty && (
        <EditActionBar editor={editor} editorState={editorState} />
      )}

      {!isDashboardView && showRotateHint && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: editor.isDirty ? 'translateX(calc(-50% + 100px))' : 'translateX(-50%)',
            zIndex: 49,
            background: 'var(--pixel-hint-bg)',
            color: '#fff',
            fontSize: '20px',
            padding: '3px 8px',
            borderRadius: 0,
            border: '2px solid var(--pixel-accent)',
            boxShadow: 'var(--pixel-shadow)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <span dangerouslySetInnerHTML={{ __html: t.pressRToRotate }} />
        </div>
      )}

      {!isDashboardView && editor.isEditMode && (() => {
        // 從當前佈局計算所選家具的顏色和文字
        const selUid = editorState.selectedFurnitureUid
        const selItem = selUid
          ? officeState.getLayout().furniture.find((f) => f.uid === selUid)
          : null
        const selColor = selItem?.color ?? null
        const selText = selItem?.text ?? null
        const selIsPixelText = selItem?.text !== undefined
        return (
          <EditorToolbar
            activeTool={editorState.activeTool}
            selectedTileType={editorState.selectedTileType}
            selectedFurnitureType={editorState.selectedFurnitureType}
            selectedFurnitureUid={selUid}
            selectedFurnitureColor={selColor}
            selectedFurnitureText={selText}
            selectedFurnitureIsPixelText={selIsPixelText}
            floorColor={editorState.floorColor}
            wallColor={editorState.wallColor}
            onToolChange={editor.handleToolChange}
            onTileTypeChange={editor.handleTileTypeChange}
            onFloorColorChange={editor.handleFloorColorChange}
            onWallColorChange={editor.handleWallColorChange}
            onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
            onSelectedFurnitureTextChange={editor.handleSelectedFurnitureTextChange}
            onFurnitureTypeChange={editor.handleFurnitureTypeChange}
            loadedAssets={loadedAssets}
          />
        )
      })()}

      {!isDashboardView && (
        <AgentLabels
          officeState={officeState}
          agents={agents}
          agentStatuses={agentStatuses}
          containerRef={containerRef}
          zoom={editor.zoom}
          panRef={editor.panRef}
          subagentCharacters={subagentCharacters}
        />
      )}

      {!isDashboardView && (
        <ToolOverlay
          officeState={officeState}
          agents={agents}
          agentTools={agentTools}
          agentModels={agentModels}
          subagentCharacters={subagentCharacters}
          containerRef={containerRef}
          zoom={editor.zoom}
          panRef={editor.panRef}
          onCloseAgent={handleCloseAgent}
          agentProjects={agentProjects}
          remoteAgents={remoteAgents}
          agentTranscripts={agentTranscripts}
          agentGitBranches={agentGitBranches}
          agentTeams={agentTeams}
          agentCliTypes={agentCliTypes}
        />
      )}

      {!isDashboardView && isDebugMode && (
        <DebugView
          agents={agents}
          selectedAgent={selectedAgent}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          subagentTools={subagentTools}
          onSelectAgent={handleSelectAgent}
        />
      )}

      {!isDashboardView && terminalTabs.length > 0 && (
        <TerminalPanel
          tabs={terminalTabs}
          activeTabId={activeTerminalTabId}
          onSelectTab={setActiveTerminalTabId}
          onCloseTab={handleCloseTerminalTab}
          onClosePanel={handleCloseTerminalPanel}
        />
      )}

      {!isDashboardView && contextMenu && (() => {
        const os = getOfficeState()
        const ch = os.characters.get(contextMenu.agentId)
        if (!ch) return null
        const isSubagent = ch.isSubagent
        const isRemote = !!remoteAgents[contextMenu.agentId]
        const meta = os.subagentMeta.get(contextMenu.agentId)
        const actions: ContextMenuAction[] = []
        if (isSubagent && meta) {
          actions.push({ label: t.contextFocusParent, onClick: () => {
            os.selectedAgentId = meta.parentAgentId
            os.cameraFollowId = meta.parentAgentId
          }})
        } else {
          actions.push({ label: t.contextGoToSeat, onClick: () => {
            os.sendToSeat(contextMenu.agentId)
          }})
          actions.push({ label: t.contextFollowCamera, onClick: () => {
            os.selectedAgentId = contextMenu.agentId
            os.cameraFollowId = contextMenu.agentId
          }})
          if (building && building.floors.length > 1) {
            actions.push({ label: t.contextMoveFloor, onClick: () => {
              const targetFloor = building.floors.find((f) => f.id !== currentFloorId)
              if (targetFloor) {
                vscode.postMessage({ type: 'moveAgentToFloor', agentId: contextMenu.agentId, targetFloorId: targetFloor.id })
              }
            }})
          }
          actions.push({ label: t.setTeam, onClick: () => {
            const current = agentTeams[contextMenu.agentId] || ''
            const name = prompt(t.teamName, current)
            if (name !== null) {
              vscode.postMessage({ type: 'setAgentTeam', agentId: contextMenu.agentId, teamName: name || null })
            }
          }})
          if (!isRemote) {
            actions.push({ label: t.openTerminal, onClick: () => {
              handleOpenTerminal(contextMenu.agentId)
            }})
            actions.push({ label: t.closeAgent, onClick: () => {
              handleCloseAgent(contextMenu.agentId)
            }})
          }
        }
        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            actions={actions}
            onClose={handleCloseContextMenu}
          />
        )
      })()}
    </div>
  )
}

export default App
