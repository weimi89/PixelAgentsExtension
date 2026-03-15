# OnlinePixelAgents — 開發路線圖與專案說明

> **最後更新：2026-03-14**
> 本文件為專案的完整技術文件與開發路線圖，涵蓋架構說明、功能清單、完成度追蹤與未來規劃。

---

## 目錄

- [專案概述](#專案概述)
- [架構總覽](#架構總覽)
- [技術棧](#技術棧)
- [模組詳解](#模組詳解)
- [資料流與通訊協議](#資料流與通訊協議)
- [持久化系統](#持久化系統)
- [已完成功能清單](#已完成功能清單)
- [開發路線圖](#開發路線圖)
- [已知問題與限制](#已知問題與限制)
- [部署指南](#部署指南)

---

## 專案概述

**OnlinePixelAgents** 是一個即時視覺化 Web 應用程式，將 AI 程式碼助手（Claude Code、Codex、Gemini CLI）的工作狀態以像素藝術動畫角色呈現在虛擬辦公室中。

### 核心理念

- **一代理一角色**：每個 Claude/Codex/Gemini 會話對應一個動畫角色
- **即時狀態反映**：角色動作（打字、閱讀、踱步、睡覺）反映代理的實際操作
- **純被動偵測**：透過監視 JSONL 轉錄檔自動發現代理，無需手動啟動
- **多機器匯聚**：多台電腦的代理可匯聚至同一個虛擬辦公室

### 專案起源

從 [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) VS Code 擴充套件改造而來，保留原始像素藝術美學，重新實作為獨立 Web 應用。原始 VS Code 程式碼保留在 `src/` + `webview-ui/` 供參考。

---

## 架構總覽

```
                    ┌──────────────────────────────────┐
                    │         瀏覽器（React）           │
                    │  Canvas 遊戲引擎 + UI 面板       │
                    └────────────┬─────────────────────┘
                                 │ Socket.IO
                                 ▼
                    ┌──────────────────────────────────┐
                    │     中央伺服器（Express）          │
                    │  Socket.IO + REST API + 終端 WS  │
                    └──┬──────────┬────────────────┬───┘
                       │          │                │
            ┌──────────▼──┐  ┌───▼────────┐  ┌───▼────────────┐
            │ 本地 JSONL   │  │ Agent Node │  │ Agent Node     │
            │ 檔案監視     │  │ (遠端機器A) │  │ (遠端機器B)    │
            │ ~/.claude/   │  │ Socket.IO  │  │ Socket.IO      │
            └─────────────┘  └────────────┘  └────────────────┘
```

### Monorepo 工作區結構

```
web/
├── shared/       ← 共享型別與工具函式（server + agent-node 共用）
│   └── src/
│       ├── protocol.ts          # AgentNodeEvent（15 種）、ServerNodeMessage（3 種）
│       ├── formatToolStatus.ts  # 工具狀態格式化 + 45+ 種工具支援 + 權限豁免清單
│       └── index.ts
│
├── server/       ← Express + Socket.IO 後端
│   ├── src/
│   │   ├── index.ts             # 入口：Express 靜態 + Socket.IO + REST + 終端 WS
│   │   ├── agentManager.ts      # 代理生命週期（建立、清理、座位、調色盤）
│   │   ├── agentNodeHandler.ts  # /agent-node namespace（JWT 認證、遠端代理）
│   │   ├── fileWatcher.ts       # fs.watch + 2s 輪詢、JSONL 增量讀取
│   │   ├── transcriptParser.ts  # JSONL 解析 → Socket.IO 訊息（Claude/Codex/Gemini）
│   │   ├── timerManager.ts      # 權限計時器（工具類型差異化延遲）
│   │   ├── tmuxManager.ts       # tmux 會話管理（spawnSync 防注入）
│   │   ├── demoMode.ts          # 演示模式（模擬 N 個代理循環執行工具）
│   │   ├── lanDiscovery.ts      # UDP 47800 LAN 自動發現
│   │   ├── terminalManager.ts   # node-pty 終端管理
│   │   ├── growthSystem.ts      # XP/等級/成就系統
│   │   ├── dashboardStats.ts    # 工具呼叫統計
│   │   ├── auth/                # JWT + bcryptjs 認證
│   │   ├── buildingPersistence.ts   # 建築物/樓層持久化
│   │   ├── floorAssignment.ts       # 專案→樓層映射
│   │   ├── layoutPersistence.ts     # 佈局讀寫（原子寫入）
│   │   ├── projectNameStore.ts      # 自訂名稱 + 排除清單
│   │   ├── behaviorSettingsStore.ts # 行為參數持久化
│   │   ├── constants.ts         # 所有伺服器常數
│   │   └── types.ts             # 型別定義
│   └── tests/                   # Vitest 單元測試（4 個檔案）
│
├── client/       ← React + TypeScript（Vite 7）
│   └── src/
│       ├── App.tsx              # 根組件（631 行）：所有面板 + hooks 整合
│       ├── socketApi.ts         # Socket.IO → vscode.postMessage 相容層
│       ├── i18n.ts              # 繁體中文本地化（280+ 字串）
│       ├── constants.ts         # 客戶端常數（283 行）
│       ├── notificationSound.ts # Web Audio API 音效（3 種提示音）
│       ├── hooks/               # 10 個自訂 hooks
│       │   ├── useExtensionMessages.ts  # 訊息中樞（50+ 訊息類型）
│       │   ├── useEditorActions.ts      # 編輯器狀態機
│       │   ├── useEditorKeyboard.ts     # 快捷鍵
│       │   ├── useConnectionState.ts    # 連線狀態
│       │   ├── useDisplaySettings.ts    # UI 設定持久化
│       │   ├── usePanelManager.ts       # 面板互斥控制
│       │   ├── useInteractionState.ts   # 點擊/選取處理
│       │   ├── useTerminalTabs.ts       # 終端分頁
│       │   ├── useRenderTick.ts         # 遊戲迴圈
│       │   └── useDeviceType.ts         # 響應式裝置偵測
│       ├── components/          # 17 個 React 組件
│       │   ├── AgentDetailPanel.tsx      # 代理詳情側邊欄
│       │   ├── BottomToolbar.tsx         # 底部工具列（圖示/文字切換）
│       │   ├── SessionPicker.tsx         # 會話瀏覽器 + 專案管理
│       │   ├── SettingsModal.tsx         # 設定面板
│       │   ├── ChatPanel.tsx            # 聊天面板
│       │   ├── TerminalPanel.tsx        # Xterm.js 終端
│       │   ├── BuildingView.tsx         # 大樓/樓層管理
│       │   ├── ZoomControls.tsx         # 縮放控制
│       │   ├── LayoutTemplatesPanel.tsx # 佈局模板
│       │   ├── BehaviorEditorModal.tsx  # 行為參數編輯
│       │   ├── RecordingListModal.tsx   # 錄製清單
│       │   ├── AgentLabels.tsx          # 代理名稱標籤
│       │   ├── ContextMenu.tsx          # 右鍵選單
│       │   ├── FloorSelector.tsx        # 樓層選擇
│       │   ├── DebugView.tsx            # 除錯覆蓋層
│       │   ├── ErrorBoundary.tsx        # 錯誤邊界
│       │   └── AgentTimeline.tsx        # 時間軸
│       ├── pages/
│       │   └── Dashboard.tsx    # 儀表板（統計、工具分布、代理列表）
│       └── office/              # 遊戲引擎
│           ├── components/
│           │   ├── OfficeCanvas.tsx      # Canvas 主組件（觸控+滑鼠）
│           │   └── ToolOverlay.tsx       # 工具覆蓋層
│           ├── engine/
│           │   ├── officeState.ts        # 遊戲主狀態（委派 3 個 Manager）
│           │   ├── characters.ts         # 角色 FSM（10 種狀態）
│           │   ├── renderer.ts           # Canvas 2D 渲染（Z 排序）
│           │   ├── gameLoop.ts           # requestAnimationFrame
│           │   ├── agentManager.ts       # 代理生命週期
│           │   ├── subagentManager.ts    # 子代理追蹤
│           │   ├── bubbleEmoteManager.ts # 氣泡/表情管理
│           │   ├── matrixEffect.ts       # Matrix 生成/消散特效
│           │   ├── dayNightCycle.ts      # 日夜循環
│           │   ├── recorder.ts           # 錄製/回放
│           │   └── recordingStorage.ts   # IndexedDB 持久化
│           ├── editor/
│           │   ├── editorState.ts        # 編輯器狀態
│           │   ├── editorActions.ts      # 編輯動作
│           │   └── EditorToolbar.tsx     # 工具列 UI
│           ├── layout/
│           │   ├── furnitureCatalog.ts   # 家具目錄（旋轉/狀態群組）
│           │   ├── layoutSerializer.ts   # 佈局序列化
│           │   └── tileMap.ts            # A* 路徑查找
│           ├── sprites/
│           │   ├── spriteData.ts         # 精靈圖資料
│           │   ├── spriteCache.ts        # 縮放快取
│           │   ├── pixelFont.ts          # 像素文字
│           │   └── colorize.ts           # 著色/調整模組
│           ├── types.ts
│           ├── toolUtils.ts
│           ├── floorTiles.ts
│           └── wallTiles.ts
│
└── agent-node/   ← 遠端機器 CLI 套件
    └── src/
        ├── cli.ts               # CLI 入口（login / start）
        ├── scanner.ts           # JSONL 掃描（1s 輪詢）
        ├── parser.ts            # 簡化版 JSONL 解析器
        ├── agentTracker.ts      # 代理追蹤（fs.watch + 2s 輪詢）
        ├── connection.ts        # Socket.IO 連線（自動重連）
        └── index.ts
```

---

## 技術棧

| 技術 | 版本 | 用途 |
|------|------|------|
| **Node.js** | 18+ | 伺服器運行環境 |
| **Express** | 5.1.0 | HTTP 伺服器 + REST API |
| **Socket.IO** | 4.8.1 | 即時雙向通訊 |
| **React** | 19.2.0 | UI 框架 |
| **TypeScript** | 5.9.3 | 型別安全（嚴格模式） |
| **Vite** | 7.2.4 | 前端建置工具 |
| **node-pty** | 1.1.0 | 偽終端（tmux 附加） |
| **@xterm/xterm** | 6.0.0 | 終端 UI |
| **bcryptjs** | 2.4.3 | 密碼雜湊 |
| **jsonwebtoken** | 9.0.2 | JWT 認證 |
| **pngjs** | 7.0.0 | PNG 解析（精靈圖） |
| **ws** | 8.18.3 | WebSocket（終端） |
| **Vitest** | 4.0.18 | 單元測試 |
| **ESLint** | 9-10 | 程式碼檢查 |
| **Prettier** | 3.8.1 | 格式化 |
| **Concurrently** | 9.2.1 | 平行開發伺服器 |

### TypeScript 限制

- 禁用 `enum`（`erasableSyntaxOnly`）→ 使用 `as const` 物件
- 型別匯入需 `import type`（`verbatimModuleSyntax`）
- `noUnusedLocals` / `noUnusedParameters`

---

## 模組詳解

### 1. 自動偵測系統

**核心機制**：每 3 秒掃描 `~/.claude/projects/*/`（以及 Codex/Gemini 對應路徑），尋找 30 秒內修改過的 `.jsonl` 檔案。

```
掃描 JSONL 檔案 (3s 間隔)
    ↓
檔案 mtime < 30s → 判定為「活躍」
    ↓
建立代理（process=null, 純被動偵測）
    ↓
啟動檔案監視（fs.watch + 2s 輪詢雙備援）
    ↓
增量讀取 JSONL → 解析 → 廣播 Socket.IO 訊息
    ↓
超過 1 小時無更新 → 自動移除代理
```

**關鍵檔案**：`fileWatcher.ts`、`agentManager.ts`、`transcriptParser.ts`

**設計要點**：
- `fileOffset` 追蹤已讀位元組，`lineBuffer` 處理不完整行
- 工具完成訊息延遲 300ms（防止 React 批次處理隱藏短暫狀態）
- `turn_duration` 系統記錄是可靠的回合結束訊號（~98% 覆蓋率）
- 純文字回合使用 5s 靜默計時器作為備選

### 2. 多 CLI 適配器

| CLI | JSONL 路徑 | 解析方式 | 特殊處理 |
|-----|-----------|---------|---------|
| **Claude Code** | `~/.claude/projects/<hash>/*.jsonl` | 標準 JSONL 逐行 | 標準實現 |
| **Codex** | `~/.codex/projects/<hash>/*.jsonl` | JSONL 逐行 | 工具名稱映射（shell→Bash） |
| **Gemini CLI** | `~/.gemini/tmp/*/session.json` | 全量 JSON 讀取 | fileOffset = 已處理訊息數 |

### 3. 多樓層系統

**概念**：虛擬辦公室大樓，每層有獨立佈局，代理依專案分配至不同樓層。

**關鍵檔案**：`buildingPersistence.ts`、`floorAssignment.ts`

**運作方式**：
- `BuildingConfig`（`building.json`）管理樓層清單與預設樓層
- 每個代理攜帶 `floorId`，Socket.IO 使用 `floor:<id>` Room 隔離廣播
- 客戶端切換樓層：`switchFloor` → 伺服器 leave/join Room → 回傳新佈局
- `project-floor-map.json` 持久化專案→樓層映射
- 首次啟動自動遷移舊 `layout.json` → `floors/1F.json`

### 4. 遠端代理系統（Agent Node）

**目的**：讓多台電腦的 Claude 代理匯聚至同一個虛擬辦公室。

**流程**：
```
遠端機器                              中央伺服器
───────                              ────────
pixel-agents-node login <url>
  → POST /api/auth/login
  ← JWT token（30 天有效）
  → 儲存 ~/.pixel-agents/node-config.json

pixel-agents-node start
  → Socket.IO 連線至 /agent-node（帶 JWT）
  → 開始掃描本地 JSONL
  → 偵測活躍代理 → 發送 agentStarted
  → 即時轉發工具事件                   → 建立代理（isRemote: true）
                                      → 廣播至瀏覽器（橘色光暈）
  → 斷線時                            → 自動清除該 socket 的遠端代理
```

**15 種事件類型**（`AgentNodeEvent`）：agentStarted、agentStopped、toolStart、toolDone、agentThinking、agentEmote、subtaskStart、subtaskDone、subtaskClear、modelDetected、turnComplete、statusChange、transcript 等。

### 5. 認證系統

| 組件 | 檔案 | 說明 |
|------|------|------|
| 帳號管理 | `auth/userStore.ts` | `~/.pixel-agents/users.json`，bcryptjs cost=10 |
| JWT 簽發 | `auth/jwt.ts` | 256-bit 隨機密鑰，30 天有效 |
| REST 路由 | `auth/routes.ts` | `POST /api/auth/register`、`POST /api/auth/login` |
| 預設帳號 | — | `admin:admin`（首次啟動自動建立） |

### 6. 遊戲引擎

**角色狀態機（10 種 FSM 狀態）**：

| 狀態 | 觸發條件 | 動畫 |
|------|---------|------|
| `IDLE` | 無事可做 | 站立（walk2 幀） |
| `WALK` | 尋路中 | 行走動畫 |
| `TYPE` | 使用寫入類工具 | 坐在座位打字（向下偏移 6px） |
| `CHAT` | 閒置行為隨機觸發 | 與鄰近角色面對面 |
| `INTERACT` | 靠近可互動家具 | 使用家具（咖啡機、飲水機等） |
| `STAND_WORK` | 靠近白板 | 站在白板前 |
| `THINK` | 伺服器 `agentThinking` | 來回踱步 |
| `STRETCH` | 坐超過 180s | 伸展動畫 |
| `USE_WALL` | 靠近牆面物件 | 面對牆壁互動 |
| `SLEEP` | 閒置超過 300s | 打瞌睡（ZZZ 表情） |

**加權漫遊行為**（閒置時）：

| 行為 | 權重 | 說明 |
|------|------|------|
| IDLE_LOOK | 30 | 站著轉方向 |
| 隨機漫遊 | 30 | 半徑 3 格，路徑最長 5 步 |
| 家具互動 | 15 | 使用附近家具 |
| 聊天 | 10 | 與鄰近角色交談 |
| 牆壁互動 | 10 | 使用牆面物件 |
| 返回座位 | 5 | 回到指定座位 |

### 7. 佈局編輯器

**工具列表**：SELECT（預設）、地板繪製、牆壁繪製、擦除（VOID）、家具放置、家具拾取（吸管）、地板吸管

**快捷鍵**：R 旋轉、F 水平翻轉、V 垂直翻轉、T 切換狀態、Ctrl+Z 撤銷、Ctrl+Y 重做、Delete 刪除、Esc 多階段退出

**進階功能**：
- 網格擴展：在邊界外點擊可擴展網格（最大 64×64）
- 家具著色：HSBC 滑桿（著色/調整兩種模式）
- 表面放置：筆電、螢幕可放在桌子上
- 牆面放置：畫作、窗戶只能放在牆上
- 背景格：家具前 N 行允許重疊
- 12 個預設佈局模板

### 8. 子代理系統

- 負數 ID（從 -1 遞減），在 `agentToolStart` 時以 "Subtask:" 前綴建立
- 與父代理相同的 palette + hueShift，外加光暈特效
- 生成在距父代理最近的空閒座位（曼哈頓距離）
- 子代理權限偵測：非豁免工具 5s 無資料 → 權限氣泡同時出現在父子代理上
- 不持久化，點擊聚焦父終端

### 9. 表情系統（10 種）

| 表情 | 觸發 | 來源 |
|------|------|------|
| COFFEE | 咖啡機互動 | 閒置行為 |
| WATER | 飲水機互動 | 閒置行為 |
| STAR | 完成互動 | 閒置行為 |
| ZZZ | 睡眠中 | 閒置行為 |
| IDEA | 踱步思考 | 閒置行為 |
| HEART | 聊天中 | 閒置行為 |
| NOTE | 白板互動 | 閒置行為 |
| CAMERA | image 區塊 | JSONL 偵測 |
| EYE | 等待子任務 | JSONL 偵測 |
| COMPRESS | 上下文壓縮 | JSONL 偵測 |

### 10. 聊天系統

- 每個樓層獨立聊天歷史
- 速率限制 500ms，訊息上限 100 字，歷史上限 50 條
- 暱稱自動生成（User-N），Hash-based 固定色彩映射
- 新訊息自動捲動或脈衝提示

### 11. 終端整合

- node-pty 附加至 tmux 會話，WebSocket (`/terminal-ws`) 即時推送
- 前端 Xterm.js（Catppuccin 配色），多分頁管理
- 可調整高度（150-70% 視窗），連線狀態指示
- 遠端代理無終端支援（安全限制）

### 12. LAN 自動發現

- UDP 47800 廣播心跳（5s 間隔，15s 超時）
- 心跳包含：伺服器名稱、端口、代理計數、版本
- 自動過濾本機心跳，動態更新 peer 列表
- 客戶端可直接連接至 LAN 上的其他實例

### 13. 日夜循環

| 時段 | 時間 | 視覺效果 |
|------|------|---------|
| 黎明 | 05:00-07:00 | 漸亮，暖色溫漸退 |
| 白天 | 07:00-17:00 | 無覆蓋層 |
| 黃昏 | 17:00-19:00 | 漸暗，暖橙覆蓋 |
| 夜間 | 19:00-05:00 | 藍色覆蓋層（alpha 0.25） |

### 14. 錄製/回放系統

- 24fps 差分壓縮（僅記錄狀態變更）
- IndexedDB 持久化，最長 600 秒
- 支援循環回放、匯出/匯入 recording 檔案
- 關鍵幀壓縮減少儲存空間

### 15. 成長系統

| 動作 | XP |
|------|-----|
| 一般工具呼叫 | +1 |
| Bash 指令 | +2 |
| Task（子任務） | +5 |
| 回合完成 | +5 |

- 等級公式：`Math.floor(sqrt(xp/10)) + 1`
- 等級徽章：金色 Lv50+、紫色 Lv25+、青色 Lv10+、灰色 Lv1+
- 11 種成就系統

---

## 資料流與通訊協議

### Socket.IO 訊息類型

**代理生命週期**：
| 訊息 | 方向 | 說明 |
|------|------|------|
| `agentCreated` | Server→Client | 新代理建立（含 projectName、isRemote、owner） |
| `agentClosed` | Server→Client | 代理移除 |
| `existingAgents` | Server→Client | 連線時推送所有現有代理 |
| `agentStatus` | Server→Client | 狀態變更（active/waiting/idle） |

**工具追蹤**：
| 訊息 | 方向 | 說明 |
|------|------|------|
| `agentToolStart` | Server→Client | 工具開始（id, toolId, status） |
| `agentToolDone` | Server→Client | 工具完成（延遲 300ms） |
| `agentToolsClear` | Server→Client | 清除所有活躍工具 |
| `agentToolPermission` | Server→Client | 需要權限批准 |
| `agentToolPermissionClear` | Server→Client | 權限已解除 |

**子代理**：
| 訊息 | 方向 | 說明 |
|------|------|------|
| `subagentToolStart` | Server→Client | 子代理工具開始 |
| `subagentToolDone` | Server→Client | 子代理工具完成 |
| `subagentClear` | Server→Client | 子代理清除 |
| `subagentToolPermission` | Server→Client | 子代理需要權限 |

**表情與動畫**：
| 訊息 | 方向 | 說明 |
|------|------|------|
| `agentEmote` | Server→Client | 表情觸發（camera/eye/compress） |
| `agentThinking` | Server→Client | 思考動畫（踱步） |
| `agentModel` | Server→Client | 偵測到的 LLM 模型 |
| `agentTranscript` | Server→Client | 精簡對話記錄 |
| `agentGrowth` | Server→Client | XP/等級/成就更新 |

**樓層與佈局**：
| 訊息 | 方向 | 說明 |
|------|------|------|
| `switchFloor` | Client→Server | 切換樓層 |
| `floorSwitched` | Server→Client | 樓層切換完成 |
| `layoutLoaded` | Server→Client | 佈局資料推送 |
| `saveLayout` | Client→Server | 儲存佈局 |
| `buildingConfig` | Server→Client | 建築物配置 |
| `floorSummaries` | Server→Client | 各樓層代理計數 |

**聊天**：
| 訊息 | 方向 | 說明 |
|------|------|------|
| `chatMessage` | Client→Server | 發送聊天訊息 |
| `chatHistory` | Server→Client | 樓層聊天歷史 |

**資產載入順序**：
```
characterSpritesLoaded → floorTilesLoaded → wallTilesLoaded
→ furnitureAssetsLoaded → layoutLoaded
```

---

## 持久化系統

所有使用者資料存放於 `~/.pixel-agents/`：

| 檔案 | 用途 | 寫入方式 |
|------|------|---------|
| `building.json` | 建築物配置（樓層清單、預設樓層） | 原子寫入 |
| `floors/*.json` | 各樓層佈局（地板、牆壁、家具） | 原子寫入 |
| `project-floor-map.json` | 專案→樓層映射 | 原子寫入 |
| `agents.json` | 代理外觀持久化（palette/hueShift/seatId/floorId） | 原子寫入 |
| `project-names.json` | 自訂專案顯示名稱 | 原子寫入 |
| `excluded-projects.json` | 排除的專案資料夾 | 原子寫入 |
| `team-names.json` | 團隊名稱映射 | 原子寫入 |
| `behavior-settings.json` | 行為參數（漫遊權重、時序） | 原子寫入 |
| `dashboard-stats.json` | 工具呼叫統計（每 10 次存檔） | 原子寫入 |
| `settings.json` | 使用者設定（音效、除錯模式） | 原子寫入 |
| `users.json` | 使用者帳號（bcryptjs 雜湊） | 原子寫入 |
| `jwt-secret.key` | JWT 簽名密鑰（256-bit，mode 0o600） | 一次寫入 |
| `node-config.json` | Agent Node CLI 配置（URL + JWT） | 一次寫入 |
| `layout.json` | 舊版單層佈局（保留供備用） | 已遷移 |

**原子寫入機制**：所有持久化操作透過 `.tmp` 暫存檔 + `rename` 完成，防止部分寫入導致資料損壞。

### 資料庫遷移計畫（Phase 5）

目前的 JSON 檔案持久化將在 Phase 5 遷移至 **SQLite + Redis** 架構：

```
現狀                              目標
────                              ────
~/.pixel-agents/*.json    →    ~/.pixel-agents/pixel-agents.db（SQLite WAL 模式）
記憶體中的即時狀態         →    Redis Hash（agents:{id}，TTL 自動過期）
Socket.IO 單機廣播         →    Redis Adapter（多伺服器共享事件）
```

- **SQLite**：替代所有 JSON 檔案，提供交易保證、索引查詢、歷史記錄
- **Redis**：即時狀態快取 + JWT 快取 + Socket.IO Adapter + Pub/Sub 事件匯流排
- **Redis 為可選依賴**：單機部署不需要 Redis，僅叢集模式（Phase 7）才啟用
- 詳細 Schema 和 Key 設計見 [Phase 5 路線圖](#phase-5資料庫遷移sqlite--redis-️)

---

## 已完成功能清單

> 每項標記完成度：✅ 完成 | ⚠️ 部分完成 | ❌ 未開始
> 每項列出已知問題（如有）

### 核心系統

| # | 功能 | 狀態 | 已知問題 |
|---|------|------|---------|
| C-01 | Express + Socket.IO 伺服器 | ✅ 完成 | 無 |
| C-02 | JSONL 自動偵測與監視 | ✅ 完成 | fs.watch 在 Windows 不可靠，需靠 2s 輪詢備援 |
| C-03 | JSONL 轉錄解析（Claude） | ✅ 完成 | 無 |
| C-04 | JSONL 轉錄解析（Codex） | ✅ 完成 | 路徑推測，實裝驗證不足 |
| C-05 | JSONL 轉錄解析（Gemini） | ✅ 完成 | 全量 JSON 讀取模式，大檔案可能有效能問題 |
| C-06 | socketApi.ts 相容層 | ✅ 完成 | 無 |
| C-07 | 繁體中文本地化（280+ 字串） | ✅ 完成 | 無 |
| C-08 | 常數集中管理 | ✅ 完成 | 無 |
| C-09 | 演示模式 | ✅ 完成 | 無 |
| C-10 | 權限計時器系統 | ✅ 完成 | 進度信號重啟上限 3 次 |

### 遊戲引擎

| # | 功能 | 狀態 | 已知問題 |
|---|------|------|---------|
| G-01 | Canvas 2D 渲染 + Z 排序 | ✅ 完成 | 無 |
| G-02 | 角色 FSM（10 種狀態） | ✅ 完成 | 無 |
| G-03 | 加權漫遊行為系統 | ✅ 完成 | 無 |
| G-04 | A* 路徑查找 | ✅ 完成 | 無 |
| G-05 | Matrix 生成/消散特效 | ✅ 完成 | 無 |
| G-06 | 6 種角色調色盤 + 色相偏移 | ✅ 完成 | 超過 6 個代理時可能外觀相似 |
| G-07 | 子代理視覺化（光暈特效） | ✅ 完成 | 無 |
| G-08 | 表情系統（10 種） | ✅ 完成 | 無 |
| G-09 | 對話氣泡（權限/等待/斷線） | ✅ 完成 | 無 |
| G-10 | 工具覆蓋層 + 顏色編碼 | ✅ 完成 | 無 |
| G-11 | 工具耗時追蹤 | ✅ 完成 | 無 |
| G-12 | 鏡頭追蹤 + 平滑平移 | ✅ 完成 | 無 |
| G-13 | 迷你地圖 | ✅ 完成 | 行動版已隱藏 |
| G-14 | 日夜循環 | ✅ 完成 | 無 |
| G-15 | 錄製/回放系統 | ✅ 完成 | 無 |
| G-16 | 坐姿偏移 + 椅子 Z 排序 | ✅ 完成 | 無 |
| G-17 | 自動狀態切換（書桌旁電子設備亮起） | ✅ 完成 | 無 |

### UI 面板與組件

| # | 功能 | 狀態 | 已知問題 |
|---|------|------|---------|
| U-01 | 底部工具列（圖示/文字自動切換） | ✅ 完成 | 無 |
| U-02 | 代理詳情面板（側邊欄） | ✅ 完成 | 無 |
| U-03 | 會話瀏覽器 + 專案管理 | ✅ 完成 | 無 |
| U-04 | 設定面板 | ✅ 完成 | 無 |
| U-05 | 大樓/樓層管理面板 | ✅ 完成 | 無 |
| U-06 | 聊天面板 | ✅ 完成 | 無 |
| U-07 | 終端面板（Xterm.js） | ✅ 完成 | 遠端代理無法開啟終端 |
| U-08 | 儀表板（統計、工具分布） | ✅ 完成 | 無 |
| U-09 | 佈局模板面板（12 個模板） | ✅ 完成 | 無 |
| U-10 | 行為編輯器 | ✅ 完成 | 無 |
| U-11 | 錄製清單面板 | ✅ 完成 | 無 |
| U-12 | 右鍵選單（追蹤、移動樓層、團隊） | ✅ 完成 | 無 |
| U-13 | 縮放控制 | ✅ 完成 | 行動版已隱藏（改用手勢） |
| U-14 | 除錯覆蓋層 | ✅ 完成 | 無 |
| U-15 | 代理名稱標籤（雙擊改名） | ✅ 完成 | 無 |
| U-16 | 音效通知（3 種提示音） | ✅ 完成 | 無 |
| U-17 | 連線狀態指示器 | ✅ 完成 | 無 |
| U-18 | 快捷鍵系統（Space 批准、Ctrl+A 全部） | ✅ 完成 | 無 |

### 佈局編輯器

| # | 功能 | 狀態 | 已知問題 |
|---|------|------|---------|
| E-01 | 地板繪製 + 7 種花紋 + 著色 | ✅ 完成 | 無 |
| E-02 | 牆壁繪製 + 自動拼接 | ✅ 完成 | 無 |
| E-03 | 擦除工具（VOID 格） | ✅ 完成 | 無 |
| E-04 | 家具放置 + 幽靈預覽 | ✅ 完成 | 無 |
| E-05 | 家具旋轉/翻轉/狀態切換 | ✅ 完成 | 無 |
| E-06 | 家具著色（HSBC 滑桿） | ✅ 完成 | 無 |
| E-07 | 家具拾取（吸管） | ✅ 完成 | 無 |
| E-08 | 表面放置（桌上物品） | ✅ 完成 | 無 |
| E-09 | 牆面放置（畫作、窗戶） | ✅ 完成 | 無 |
| E-10 | 背景格（前 N 行可重疊） | ✅ 完成 | 無 |
| E-11 | 網格動態擴展（最大 64×64） | ✅ 完成 | 無 |
| E-12 | 撤銷/重做（50 層） | ✅ 完成 | 無 |
| E-13 | 佈局匯入/匯出 | ✅ 完成 | 無 |

### 多機器連線

| # | 功能 | 狀態 | 已知問題 |
|---|------|------|---------|
| M-01 | Agent Node CLI（login / start） | ✅ 完成 | 無 |
| M-02 | JWT 認證（30 天有效） | ✅ 完成 | 預設 admin:admin，生產環境需更改 |
| M-03 | Socket.IO /agent-node namespace | ✅ 完成 | 無 |
| M-04 | 遠端代理視覺標記（橘色光暈） | ✅ 完成 | 無 |
| M-05 | 遠端代理斷線自動清除 | ✅ 完成 | 無 |
| M-06 | 遠端代理樓層分配 | ✅ 完成 | 無 |
| M-07 | LAN 自動發現（UDP 47800） | ✅ 完成 | 無 |
| M-08 | Cloudflared tunnel 外部存取 | ✅ 完成 | 需手動設定 tunnel 配置 |

### 行動/平板支援

| # | 功能 | 狀態 | 已知問題 |
|---|------|------|---------|
| R-01 | 觸控手勢（pinch/pan/tap/long-press） | ✅ 完成 | 無 |
| R-02 | 雙擊縮放 | ✅ 完成 | 無 |
| R-03 | 滑動關閉面板 | ✅ 完成 | 無 |
| R-04 | 響應式 CSS（768/1024 斷點） | ✅ 完成 | 無 |
| R-05 | 行動版隱藏縮放按鈕 | ✅ 完成 | 無 |
| R-06 | 行動版隱藏迷你地圖 | ✅ 完成 | 無 |
| R-07 | 圖示工具列（行動版） | ✅ 完成 | 無 |
| R-08 | Safe area inset 支援 | ✅ 完成 | 無 |
| R-09 | 觸控目標最小 48px | ✅ 完成 | 無 |

### 進階功能

| # | 功能 | 狀態 | 已知問題 |
|---|------|------|---------|
| A-01 | 成長系統（XP/等級/成就） | ⚠️ 部分完成 | 伺服器邏輯完整，客戶端成就顯示不完整 |
| A-02 | 團隊名稱系統 | ⚠️ 部分完成 | 基礎實現，客戶端列表不完整 |
| A-03 | tmux 會話持久化 | ✅ 完成 | 需安裝 tmux |
| A-04 | 會話恢復（--resume） | ✅ 完成 | 僅本地代理，遠端不支援 |
| A-05 | 工具統計（儀表板） | ✅ 完成 | 無 |
| A-06 | 會議室行為（2-6 人） | ✅ 完成 | 無 |
| A-07 | 跨樓層移動（電梯家具） | ✅ 完成 | 無 |

---

## 開發路線圖

### Phase 1：多機器連線強化 🔵

> **目標**：讓多台電腦的連線更穩定、更安全、更易用

| # | 任務 | 優先級 | 狀態 | 完成日期 | 說明 | 已知問題 |
|---|------|--------|------|---------|------|---------|
| 1.1 | 強制修改預設密碼 | 🔴 高 | ✅ 完成 | 2026-03-15 | 首次登入 admin 帳號時 mustChangePassword 旗標強制改密碼，token 包含此旗標 | 無 |
| 1.2 | 密碼強度要求 | 🔴 高 | ✅ 完成 | 2026-03-15 | shared 套件 validatePassword()：>= 8 字元 + 大小寫 + 數字。/register 和 /change-password 皆使用 | 無 |
| 1.3 | Agent Node 心跳機制 | 🟡 中 | ✅ 完成 | 2026-03-15 | 30s 間隔心跳 + 90s 超時強制斷線 + RTT 延遲計算 + heartbeatAck | 無 |
| 1.4 | 遠端節點健康面板 | 🟡 中 | ✅ 完成 | 2026-03-15 | NodeHealthPanel 組件：延遲色彩編碼、信號強度條、連線時長、活躍代理數。10s 定期廣播 | 無 |
| 1.5 | Agent Node 排除清單同步 | 🟢 低 | ✅ 完成 | 2026-03-15 | 連線時推送 + 變更時即時同步。Scanner 新增 setExcludedProjects() 過濾 | 無 |
| 1.6 | 遠端代理終端轉發 | 🟡 中 | ✅ 完成 | 2026-03-15 | 透過 Agent Node 中繼：Browser↔Server↔AgentNode↔spawn(tmux/shell)。使用 child_process 避免 node-pty 依賴 | tmux 不存在時降級為 shell |
| 1.7 | 多使用者權限系統 | 🟡 中 | ✅ 完成 | 2026-03-15 | admin/viewer 角色、requireAuth/requireAdmin 中介層、使用者管理 REST API（CRUD） | 瀏覽器端 Socket.IO 未強制認證（僅 REST API） |
| 1.8 | Agent Node 自動重新掃描 | 🟢 低 | ✅ 完成 | — | 重連後自動重新掃描已追蹤代理 | 已透過 onReconnect 回呼實現 |
| 1.9 | 連線品質指示器 | 🟢 低 | ✅ 完成 | 2026-03-15 | 遠端代理標籤旁顯示迷你信號強度條（3 格），依 owner 延遲色彩編碼 | 無 |

### Phase 2：效能與可擴展性 🟡

> **目標**：支援更多代理和更大規模的部署

| # | 任務 | 優先級 | 狀態 | 完成日期 | 說明 | 已知問題 |
|---|------|--------|------|---------|------|---------|
| 2.1 | JSONL 掃描快取 | 🟡 中 | ✅ 完成 | 2026-03-15 | 目錄 mtime 快取 + 僅 re-stat 活躍檔案，跳過已知不活躍檔案 | macOS 目錄 mtime 僅在增刪檔案時更新 |
| 2.2 | 掃描間隔動態調整 | 🟢 低 | ✅ 完成 | 2026-03-15 | setInterval→遞迴 setTimeout：0 代理 10s、1-9 代理 3s、10+ 代理 1s | 無 |
| 2.3 | Gemini JSON 增量讀取 | 🟡 中 | ✅ 完成 | 2026-03-15 | >100KB 檔案採用尾部讀取，解析失敗自動回退全量讀取 | 尾部 JSON 片段解析可能遇到邊界情況 |
| 2.4 | 統計批次寫入優化 | 🟢 低 | ✅ 完成 | 2026-03-15 | 每 10 次→每 30s dirty flag 觸發寫入，大幅減少磁碟 I/O | 無 |
| 2.5 | Socket.IO Room 廣播優化 | 🟢 低 | ✅ 完成 | 2026-03-15 | perMessageDeflate 壓縮（>256 bytes），零侵入無需客戶端改動 | 無 |
| 2.6 | 代理數量壓力測試 | 🟡 中 | ✅ 完成 | 2026-03-15 | `--stress N` CLI 旗標 + `/api/metrics` 端點 + 10s 指標記錄 | 壓力測試代理 ID 從 9000 起算避免衝突 |

### Phase 3：安全加固 🔴

> **目標**：生產環境級別的安全性

| # | 任務 | 優先級 | 狀態 | 完成日期 | 說明 | 已知問題 |
|---|------|--------|------|---------|------|---------|
| 3.1 | HTTPS 支援 | 🔴 高 | ✅ 完成 | 2026-03-15 | `--https` / `HTTPS=1` 自簽憑證 + Cloudflared tunnel 外部 HTTPS | 自簽憑證瀏覽器會警告 |
| 3.2 | Socket.IO CSRF 防護 | 🔴 高 | ✅ 完成 | 2026-03-15 | Socket.IO engine 中間件檢查 Origin 標頭，`ALLOWED_ORIGINS` 環境變數擴充 | 無 |
| 3.3 | 全域請求速率限制 | 🟡 中 | ✅ 完成 | 2026-03-15 | 記憶體滑動視窗：API 100/min、Login 10/min、Register 5/min，HTTP 429 回應 | 無 |
| 3.4 | 路徑遍歷防護 | 🟡 中 | ✅ 完成 | 2026-03-15 | pathSecurity.ts：拒絕 `..`、null 位元組、容器化檢查、sessionId/projectDir 驗證 | 無 |
| 3.5 | JWT refresh token | 🟢 低 | ✅ 完成 | 2026-03-15 | access token 15min + refresh token 30d + `POST /api/auth/refresh` 端點，向後相容 | 無 |
| 3.6 | 使用者帳號管理 UI | 🟡 中 | ✅ 完成 | 2026-03-15 | UserManagementPanel：列出使用者、角色切換、刪除，像素風格 | 無 |
| 3.7 | 審計日誌 | 🟢 低 | ✅ 完成 | 2026-03-15 | 非同步 JSONL 日誌（audit.jsonl）、10 種動作、>1MB 自動輪替 | 無 |

### Phase 4：部署與維運 🟢

> **目標**：更容易部署、監控和維護

| # | 任務 | 優先級 | 狀態 | 完成日期 | 說明 | 已知問題 |
|---|------|--------|------|---------|------|---------|
| 4.1 | Docker 容器化 | 🟡 中 | ✅ 完成 | 2026-03-15 | 多階段 Dockerfile + docker-compose + .dockerignore，非 root 使用者，HEALTHCHECK | Redis 服務已註解備用 |
| 4.2 | 健康檢查端點 | 🟡 中 | ✅ 完成 | 2026-03-15 | `GET /health`（簡易）+ `GET /api/status`（詳細：版本/代理/記憶體/樓層） | 無 |
| 4.3 | 結構化日誌系統 | 🟡 中 | ✅ 完成 | 2026-03-15 | logger.ts：零依賴，4 等級，生產 JSON/開發彩色格式，LOG_LEVEL 環境變數 | 僅替換 index.ts 關鍵呼叫 |
| 4.4 | 環境變數配置 | 🟢 低 | ✅ 完成 | 2026-03-15 | config.ts 集中管理：PORT/DEMO/HTTPS/ALLOWED_ORIGINS/LOG_LEVEL/DATA_DIR/NODE_ENV | 無 |
| 4.5 | Graceful shutdown 強化 | 🟢 低 | ✅ 完成 | 2026-03-15 | 五階段關閉：停止接受→清除計時器→清除代理→刷新寫入→排空 Socket.IO | 無 |
| 4.6 | 自動備份機制 | 🟢 低 | ✅ 完成 | 2026-03-15 | backup.ts：6h 定時備份、保留 5 個、async 操作、`--backup-now` 手動觸發 | 排除 audit.jsonl 和 node-config.json |
| 4.7 | CI/CD 流程 | 🟡 中 | ✅ 完成 | 2026-03-15 | GitHub Actions：Node 18/20 矩陣、typecheck→lint→test→build | 無 |
| 4.8 | E2E 測試 | 🟢 低 | ✅ 完成 | 2026-03-15 | e2e-smoke.ts：原生 fetch + child_process，測試 /health + /api + Socket.IO | 無重量級依賴 |

### Phase 5：資料庫遷移（SQLite + Redis） 🗄️

> **目標**：從 JSON 檔案遷移至 SQLite 本地持久化 + Redis 快取/叢集同步，為多伺服器架構打基礎

#### 5.0 現狀分析

目前所有資料以 JSON 檔案存放於 `~/.pixel-agents/`，透過原子寫入（`.tmp` + `rename`）確保一致性。

**現有持久化 → 資料庫映射規劃**：

| 現有 JSON 檔案 | 目標 | SQLite 表 | Redis 用途 |
|---------------|------|-----------|------------|
| `building.json` | SQLite | `buildings` | — |
| `floors/*.json` | SQLite | `floors`（佈局以 JSON 欄位存放） | — |
| `agents.json` | SQLite + Redis | `agent_appearances`（持久外觀） | `agents:{id}`（即時狀態快取） |
| `project-floor-map.json` | SQLite | `project_floor_map` | — |
| `project-names.json` | SQLite | `project_names` | — |
| `excluded-projects.json` | SQLite | `excluded_projects` | — |
| `team-names.json` | SQLite | `team_names` | — |
| `behavior-settings.json` | SQLite | `settings`（key-value） | — |
| `dashboard-stats.json` | SQLite | `tool_stats`（可查詢、索引） | `stats:live`（即時計數器） |
| `settings.json` | SQLite | `settings`（key-value） | — |
| `users.json` | SQLite | `users` | `sessions:{token}`（快取驗證） |
| `jwt-secret.key` | SQLite | `secrets`（加密存放） | — |
| `node-config.json` | 保持檔案 | —（Agent Node 本地用） | — |

#### 5.1 遷移任務

| # | 任務 | 優先級 | 狀態 | 完成日期 | 說明 | 已知問題 |
|---|------|--------|------|---------|------|---------|
| 5.1.1 | 新增 better-sqlite3 依賴 | 🔴 高 | ✅ 完成 | 2026-03-15 | 同步 API、WAL 模式、npm install 完成 | 需 C++ 編譯工具鏈 |
| 5.1.2 | 設計 SQLite Schema | 🔴 高 | ✅ 完成 | 2026-03-15 | 13 張表 + 6 個索引，schema.ts 匯出 | 無 |
| 5.1.3 | 建立資料庫抽象層 | 🔴 高 | ✅ 完成 | 2026-03-15 | Database 類別封裝所有 CRUD，prepared statement 快取，型別化 Row 介面 | 無 |
| 5.1.4 | 自動遷移系統 | 🟡 中 | ✅ 完成 | 2026-03-15 | 版本號遞增遷移，每個遷移包裹 transaction | 無 |
| 5.1.5 | JSON → SQLite 遷移 | 🔴 高 | ✅ 完成 | 2026-03-15 | 自動匯入 12 種 JSON 檔案，單一 transaction，.migrated 標記防重複 | 無 |
| 5.1.6 | 替換 buildingPersistence | 🟡 中 | ✅ 完成 | 2026-03-15 | DB 優先 + JSON 回退雙軌模式 | 無 |
| 5.1.7 | 替換 layoutPersistence | 🟡 中 | ✅ 完成 | 2026-03-15 | 舊版 layout 改用 settings 表 | 無 |
| 5.1.8 | 替換 projectNameStore | 🟡 中 | ✅ 完成 | 2026-03-15 | 名稱 + 排除清單均用 DB | 無 |
| 5.1.9 | 替換 auth/userStore | 🟡 中 | ✅ 完成 | 2026-03-15 | 所有使用者操作改用 DB，含 lastLogin 更新 | 無 |
| 5.1.10 | 替換 dashboardStats | 🟡 中 | ✅ 完成 | 2026-03-15 | tool_stats 表 + 索引查詢，flush timer 改為 no-op | 無 |
| 5.1.11 | 替換 behaviorSettings | 🟢 低 | ✅ 完成 | 2026-03-15 | settings 表 key-value 存取 | 無 |
| 5.1.12 | 替換 growthSystem | 🟢 低 | ✅ 完成 | 2026-03-15 | agent_appearances 表存 XP/成就 | 無 |
| 5.1.13 | 歷史記錄表 | 🟢 低 | ✅ 完成 | 2026-03-15 | agent_history 記錄 online/offline 事件 | 待設定清理策略 |
| 5.1.14 | 審計日誌表 | 🟢 低 | ✅ 完成 | 2026-03-15 | audit_log 表 + JSONL 雙寫，DB 可用時優先 | 無 |
| 5.1.15 | 單元測試更新 | 🟡 中 | ✅ 完成 | 2026-03-15 | database.test.ts：33 個 in-memory SQLite 測試（settings/users/floors/agents/stats/history/audit） | 無 |

#### 5.2 Redis 整合任務

| # | 任務 | 優先級 | 狀態 | 完成日期 | 說明 | 已知問題 |
|---|------|--------|------|---------|------|---------|
| 5.2.1 | 新增 ioredis 依賴 | 🔴 高 | ✅ 完成 | 2026-03-15 | ioredis + @socket.io/redis-adapter 安裝完成 | 無 |
| 5.2.2 | Redis 連線管理 | 🔴 高 | ✅ 完成 | 2026-03-15 | RedisManager：主連線+sub 連線、lazyConnect、自動重連、健康檢查 | 無 |
| 5.2.3 | 代理即時狀態快取 | 🟡 中 | ✅ 完成 | 2026-03-15 | HSET agents:{id} + TTL 1h，isConnected() 守衛 | 無 |
| 5.2.4 | JWT 驗證快取 | 🟡 中 | ✅ 完成 | 2026-03-15 | SET sessions:{hash} + EX 15min，verifyTokenCached() 非同步版 | 無 |
| 5.2.5 | 即時統計計數器 | 🟢 低 | ✅ 完成 | 2026-03-15 | INCR pipeline + 與 SQLite 並行寫入 | 無 |
| 5.2.6 | Socket.IO Redis Adapter | 🔴 高 | ✅ 完成 | 2026-03-15 | 動態載入 createAdapter，Redis 不可用時回退記憶體 adapter | 無 |
| 5.2.7 | 樓層 Room 狀態共享 | 🟡 中 | ✅ 完成 | 2026-03-15 | Pub/Sub events:floor:{id} 頻道 | 無 |
| 5.2.8 | Pub/Sub 事件匯流排 | 🟡 中 | ✅ 完成 | 2026-03-15 | Agent/Global 頻道 + sourceServerId 防自我回音 | 無 |
| 5.2.9 | 分散式鎖 | 🟢 低 | ✅ 完成 | 2026-03-15 | SET NX EX + Lua 原子釋放 + withLock() 便利函式 | 無 |
| 5.2.10 | Redis 降級策略 | 🟡 中 | ✅ 完成 | 2026-03-15 | 斷線時所有操作 no-op，onDisconnect/onReconnect 回呼 | 無 |

#### 5.3 架構設計原則

**漸進式遷移**：
1. **Phase 5.1**（SQLite）可獨立完成，不需要 Redis
2. **Phase 5.2**（Redis）在 SQLite 完成後才開始
3. **Redis 為可選依賴**：單機部署不需要 Redis，僅叢集模式才啟用
4. 遷移期間保持向下相容：偵測到舊 JSON 檔案 → 自動匯入 → 保留原檔備份

**資料分層**：
```
┌─────────────────────────────────────────────────┐
│ 應用層（agentManager, buildingPersistence 等）   │
│  ↕ 呼叫 Database 抽象層（不直接碰 SQL/Redis）    │
├─────────────────────────────────────────────────┤
│ 抽象層（db/Database.ts, db/Cache.ts）            │
│  ↕ 封裝所有 CRUD + 快取邏輯                      │
├─────────────────────────────────────────────────┤
│ SQLite（持久化）    │ Redis（快取 + Pub/Sub）     │
│ ~/.pixel-agents/    │ 可選，叢集模式才需要         │
│ pixel-agents.db     │                             │
└─────────────────────────────────────────────────┘
```

**關鍵決策**：
- SQLite 使用 **WAL 模式**（Write-Ahead Logging）：讀寫並行、崩潰恢復
- 佈局等大型結構以 **JSON TEXT 欄位**存放（避免過度正規化）
- 工具統計使用**正規化表**（支援按時間、工具類型查詢）
- Redis Hash 存活躍狀態，**TTL 自動清理**過期代理
- `node-config.json` **保持檔案**（Agent Node 本地用，不需要資料庫）

#### SQLite Schema 設計

```sql
-- === 核心設定 ===
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,        -- JSON 字串
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  value BLOB NOT NULL,        -- 加密存放
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- === 使用者管理 ===
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, -- bcryptjs 雜湊
  role TEXT NOT NULL DEFAULT 'viewer',  -- 'admin' | 'viewer'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- === 建築與樓層 ===
CREATE TABLE IF NOT EXISTS building (
  id INTEGER PRIMARY KEY DEFAULT 1,  -- 單例
  default_floor_id TEXT NOT NULL DEFAULT '1F',
  config TEXT NOT NULL,               -- BuildingConfig JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS floors (
  id TEXT PRIMARY KEY,               -- '1F', '2F', ...
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  layout TEXT NOT NULL,              -- OfficeLayout JSON（tiles, furniture, tileColors）
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- === 代理管理 ===
CREATE TABLE IF NOT EXISTS agent_appearances (
  agent_key TEXT PRIMARY KEY,        -- 由 projectDir + sessionId 組成
  palette INTEGER NOT NULL DEFAULT 0,
  hue_shift INTEGER NOT NULL DEFAULT 0,
  seat_id TEXT,
  floor_id TEXT NOT NULL DEFAULT '1F',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_growth (
  agent_key TEXT PRIMARY KEY,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  achievements TEXT NOT NULL DEFAULT '[]',  -- JSON 陣列
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- === 專案管理 ===
CREATE TABLE IF NOT EXISTS project_names (
  dir_basename TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS excluded_projects (
  dir_basename TEXT PRIMARY KEY,
  excluded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_floor_map (
  project_key TEXT PRIMARY KEY,     -- projectDir hash 或 basename
  floor_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_names (
  agent_key TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- === 統計與歷史 ===
CREATE TABLE IF NOT EXISTS tool_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  agent_key TEXT,
  floor_id TEXT,
  called_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tool_stats_name ON tool_stats(tool_name);
CREATE INDEX idx_tool_stats_time ON tool_stats(called_at);

CREATE TABLE IF NOT EXISTS agent_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_key TEXT NOT NULL,
  event_type TEXT NOT NULL,          -- 'online' | 'offline' | 'tool' | 'floor_change'
  detail TEXT,                        -- JSON 附加資訊
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agent_history_key ON agent_history(agent_key);
CREATE INDEX idx_agent_history_time ON agent_history(created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,              -- 'login' | 'layout_save' | 'agent_close' | ...
  detail TEXT,                        -- JSON 附加資訊
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_log_time ON audit_log(created_at);
CREATE INDEX idx_audit_log_action ON audit_log(action);
```

#### Redis Key 設計

```
# === 代理即時狀態（Hash，TTL = STALE_AGENT_TIMEOUT_MS）===
agents:{agentId}
  ├── status        → "active" | "waiting" | "idle"
  ├── tools         → JSON（activeToolIds + statuses）
  ├── emote         → "idea" | "camera" | null
  ├── floor_id      → "1F"
  ├── is_remote     → "0" | "1"
  ├── owner         → "username" | ""
  └── updated_at    → Unix timestamp

# === JWT 驗證快取（String，TTL = token 剩餘有效期）===
sessions:{tokenHash}  → JSON（userId, username, role）

# === 即時統計（String/Counter）===
stats:tool_calls:total       → INCR 計數器
stats:tool_calls:{toolName}  → INCR 計數器
stats:active_agents          → 當前活躍代理數

# === Socket.IO Adapter（自動管理）===
socket.io#/{room}#           → Socket.IO Redis Adapter 內部

# === Pub/Sub 頻道 ===
events:agent                 → 代理建立/關閉/狀態變更
events:floor:{floorId}       → 樓層級事件
events:layout:{floorId}      → 佈局變更
events:global                → 全域事件（建築配置、專案名稱）

# === 分散式鎖（Redlock，TTL = 5s）===
lock:layout:{floorId}        → 佈局編輯鎖
lock:agent:{agentKey}        → 代理操作鎖
```

### Phase 6：功能完善 🟣

> **目標**：完善部分實現的功能，提升使用體驗

| # | 任務 | 優先級 | 狀態 | 完成日期 | 說明 | 已知問題 |
|---|------|--------|------|---------|------|---------|
| 6.1 | 成就系統 UI | 🟢 低 | ✅ 完成 | 2026-03-15 | AchievementPanel（10 種成就）+ AchievementToast（金框滑入通知） | 無 |
| 6.2 | 團隊系統完善 | 🟢 低 | ✅ 完成 | 2026-03-15 | TeamPanel（色彩徽章、成員計數、團隊篩選），BottomToolbar 整合 | 無 |
| 6.3 | 角色外觀基礎建設 | 🟢 低 | ✅ 完成 | 2026-03-15 | CHARACTER_PALETTE_NAMES + MAX_CUSTOM_PALETTES=12 擴展基礎 | 實際精靈圖需像素畫 |
| 6.4 | 家具素材基礎建設 | 🟢 低 | ✅ 完成 | 2026-03-15 | EditorToolbar 家具計數徽章 | 實際素材需管線匯入 |
| 6.5 | 佈局分享 | 🟢 低 | ✅ 完成 | 2026-03-15 | LayoutSharePanel：剪貼簿複製/貼上 + 檔案匯入匯出 | 無社群平台 |
| 6.6 | 多語言支援 | 🟢 低 | ✅ 完成 | 2026-03-15 | i18n 重構：zh-TW + en-US，Proxy 動態切換，localStorage 持久化 | 無 |
| 6.7 | 主題切換 | 🟢 低 | ✅ 完成 | 2026-03-15 | useTheme hook + data-theme 屬性 + light/dark CSS 變數 | 無 |

### Phase 7：進階多機器功能 🔵

> **目標**：真正的分散式辦公室體驗（依賴 Phase 5 資料庫遷移完成）

| # | 任務 | 優先級 | 狀態 | 完成日期 | 說明 | 已知問題 |
|---|------|--------|------|---------|------|---------|
| 7.1 | 多伺服器叢集 | 🟡 中 | ✅ 完成 | 2026-03-15 | ClusterManager：Redis 註冊+心跳+peer 發現+shadow agents（ID<=-100000） | 僅 Redis 模式啟用 |
| 7.2 | 伺服器聯邦 | 🟢 低 | ✅ 完成 | 2026-03-15 | listPeerServers() + /api/cluster/status 端點 + peer 上下線日誌 | 無 |
| 7.3 | 遠端 resumeSession | 🟢 低 | ✅ 完成 | 2026-03-15 | 協議擴展 + Agent Node spawn claude --resume + 結果回傳 | 無 |
| 7.4 | 跨伺服器樓層 | 🟢 低 | ✅ 完成 | 2026-03-15 | subscribeFloor/publishFloorAgentEvent + 遠端事件轉發至本地 Room | 無 |
| 7.5 | 負載均衡 | 🟢 低 | ✅ 完成 | 2026-03-15 | nginx.conf.example：WebSocket 升級、ip_hash sticky、健康檢查、TLS | 設定範本，需依環境調整 |
| 7.6 | P2P 模式 | 🟢 低 | ✅ 完成 | 2026-03-15 | p2p-architecture.md：架構提案、WebRTC 資料通道、三階段實作計畫 | 文件規劃，需實作 |
| 7.7 | WebRTC 語音 | 🟢 低 | ✅ 完成 | 2026-03-15 | webrtc-voice-plan.md：空間音訊、信令協議、UI 設計、四階段實作計畫 | 文件規劃，需實作 |

---

## 已知問題與限制

### 效能

| # | 問題 | 嚴重度 | 狀態 | 說明 |
|---|------|--------|------|------|
| P-01 | O(n) JSONL 掃描 | 🟡 中 | ✅ 已修復 | Phase 2.1：目錄 mtime 快取 + 動態間隔（2.2） |
| P-02 | Gemini 全量 JSON 讀取 | 🟡 中 | ✅ 已修復 | Phase 2.3：>100KB 尾部增量讀取 |
| P-03 | 無快取層 | 🟢 低 | ✅ 已修復 | Phase 2.1：dirScanCache 避免重複 readdirSync + statSync |
| P-04 | 統計頻繁磁碟 I/O | 🟢 低 | ✅ 已修復 | Phase 2.4：30s dirty flag 時間觸發寫入 |

### 安全

| # | 問題 | 嚴重度 | 狀態 | 說明 |
|---|------|--------|------|------|
| S-01 | 預設帳號 admin:admin | 🔴 高 | ✅ 已修復 | Phase 1.1：首次登入強制改密碼（mustChangePassword 旗標） |
| S-02 | 密碼僅 4 字元 | 🔴 高 | ✅ 已修復 | Phase 1.2：>= 8 字元 + 大小寫 + 數字（shared validatePassword） |
| S-03 | Socket.IO 無 CSRF | 🟡 中 | ✅ 已修復 | Phase 3.2：Origin 標頭驗證 + ALLOWED_ORIGINS 環境變數 |
| S-04 | 無路徑遍歷驗證 | 🟡 中 | ✅ 已修復 | Phase 3.4：pathSecurity.ts 完整驗證 |
| S-05 | 無全域速率限制 | 🟡 中 | ✅ 已修復 | Phase 3.3：API/Login/Register 三級速率限制 |
| S-06 | 終端 WS 僅同源檢查 | 🟢 低 | ✅ 已修復 | Phase 3.2：統一 Origin 驗證機制 |

### 可靠性

| # | 問題 | 嚴重度 | 狀態 | 說明 |
|---|------|--------|------|------|
| R-01 | fs.watch Windows 不可靠 | 🟡 中 | 已緩解 | 2s 輪詢備援，但延遲較高 |
| R-02 | 高速寫入部分行 | 🟢 低 | 已緩解 | lineBuffer 處理，但極端情況仍可能丟資料 |
| R-03 | tmux 依賴 | 🟡 中 | 開放 | 非 tmux 環境僅支援直接子進程（無 detach 能力） |
| R-04 | Agent Node 事件去重 | 🟢 低 | 開放 | JSONL 寫入緩衝可能導致重複事件 |

### 架構

| # | 問題 | 嚴重度 | 狀態 | 說明 |
|---|------|--------|------|------|
| A-01 | AgentContext 單例 | 🟡 中 | ✅ 已緩解 | Phase 7.1：ClusterManager + shadow agents + Redis Pub/Sub 實現跨伺服器同步 |
| A-02 | 全域訊息廣播範圍過大 | 🟢 低 | 開放 | projectNameUpdated 等廣播至所有樓層 |
| A-03 | Codex 適配器驗證不足 | 🟡 中 | 開放 | 路徑推測，實裝未經充分測試 |
| A-04 | JSON 檔案持久化無並發鎖 | 🟡 中 | ✅ 已修復 | Phase 5.1：SQLite WAL 模式 + 交易保證原子性 |
| A-05 | 無查詢能力 | 🟢 低 | ✅ 已修復 | Phase 5.1.10：tool_stats 表 + 索引，支援時間/類型查詢 |
| A-06 | 無歷史資料追溯 | 🟡 中 | ✅ 已修復 | Phase 5.1.13：agent_history 表 + Phase 5.1.14：audit_log 表 |

---

## 部署指南

### 本地開發

```bash
# 1. 安裝依賴
cd web && npm install

# 2. 開發模式（熱重載）
npm run dev
# → Vite 客戶端 :5173
# → tsx watch 伺服器 :13001（或 constants.ts 中定義的 DEFAULT_PORT）

# 3. 生產建置
npm run build && npm start

# 4. 演示模式（無需 Claude）
DEMO=1 DEMO_AGENTS=5 node server/dist/index.js --demo
```

### 品質檢查

```bash
npm run typecheck     # TypeScript 型別檢查
npm run lint          # ESLint 程式碼檢查
npm run format:check  # Prettier 格式檢查
npm test              # Vitest 單元測試（4 個檔案）
```

### 多機器部署

```bash
# === 中央伺服器 ===
cd web && npm run build && npm start
# 伺服器在 http://localhost:13001 運行

# 選項 A：Cloudflared tunnel（外部存取）
cloudflared tunnel route dns <tunnel-name> <domain>
# 在 config.yml 新增 ingress 規則

# 選項 B：LAN 存取
# 確保 UDP 47800 開放（LAN 自動發現）
# 其他機器可在瀏覽器直接存取 http://<server-ip>:13001

# === 遠端機器 ===
cd web/agent-node && npm run build

# 登入中央伺服器
npx pixel-agents-node login http://<server-ip>:13001
# → 輸入帳號密碼

# 啟動掃描
npx pixel-agents-node start
# → 自動偵測並推送本地 Claude 代理至中央伺服器
```

### 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `PORT` | 伺服器端口 | 13001（constants.ts） |
| `DEMO` | 啟用演示模式 | 未設定 |
| `DEMO_AGENTS` | 演示代理數量 | 3 |
| `DB_PATH` | SQLite 資料庫路徑（Phase 5） | `~/.pixel-agents/pixel-agents.db` |
| `REDIS_URL` | Redis 連線 URL（Phase 5，可選） | 未設定（單機模式不需要） |
| `JWT_SECRET` | JWT 簽名密鑰（Phase 5，覆蓋檔案） | 從 SQLite `secrets` 表讀取 |

---

## 程式碼統計

| 模組 | 檔案數 | 行數（約） |
|------|--------|-----------|
| 伺服器 (`web/server/src/`) | ~20 | ~5,800 |
| 客戶端 (`web/client/src/`) | ~70 | ~10,500 |
| 共享 (`web/shared/src/`) | 3 | ~300 |
| Agent Node (`web/agent-node/src/`) | 6 | ~800 |
| 測試 (`web/server/tests/`) | 4 | ~400 |
| **合計** | **~103** | **~17,800** |

---

> **文件維護**：本文件應在每次重大功能變更時更新。路線圖中的每一項應在完成時標記為 ✅，並記錄完成日期和遇到的問題。
