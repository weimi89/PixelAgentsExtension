# 虛擬辦公室大樓系統 — 實施計劃

> 建立日期：2026-03-01
> 目標：將 OnlinePixelAgents 從單層辦公室改造為多樓層虛擬辦公室大樓

---

## 現狀摘要

Phase 1（單人 Web 版）已 100% 完成：
- Express + Socket.IO 伺服器運作中
- socketApi.ts 相容層完備
- 自動偵測多專案的 Claude Code 代理
- 佈局編輯器、角色系統、表情系統、工具覆蓋層皆完整

**核心缺口：** 無用戶身份、無房間隔離、單一全域佈局、無樓層概念。

---

## 總體策略

**最小可行大樓（單機版）：** 不需多機器連線和認證系統，利用現有的多專案自動偵測，將每個專案映射到不同樓層，在單機上呈現大樓效果。

```
現有自動偵測（掃描多專案）
  → 每個專案自動分配樓層
  → BuildingView 電梯面板 UI
  → 點擊切換查看不同專案的辦公室
  → 每樓層獨立佈局
```

---

## 階段 A — 多樓層資料基礎

> 預估工作量：10-14 小時
> 前置條件：無

### A1. 樓層資料模型

**新增檔案：** `web/server/src/floorManager.ts`

```typescript
interface Floor {
  id: string              // 自動生成 UUID 或 slug
  number: number          // 樓層編號（1F, 2F...）
  name: string            // 顯示名稱（如「後端工程部」）
  projectDirs: string[]   // 綁定的專案目錄 basename（可多個）
  layout: OfficeLayout    // 該樓層的佈局
  accessLevel: 'public' | 'private'
}

interface Building {
  id: string
  name: string            // 大樓名稱
  floors: Floor[]
  lobbyFloorId: string    // 1F 大廳 ID
}
```

**持久化：** `~/.pixel-agents/building.json`

**關鍵決策：**
- 大廳（1F）是特殊樓層，不綁定專案，顯示所有樓層摘要
- 未綁定專案的代理自動出現在大廳
- 每樓層有獨立的佈局（不再共用 `layout.json`）

**修改檔案：**
- `web/server/src/types.ts` — 新增 Floor、Building 介面
- `web/server/src/constants.ts` — 新增樓層相關常數（預設樓層數、大廳設定）

### A2. 佈局多樓層持久化

**修改檔案：** `web/server/src/layoutPersistence.ts`

目前：單一 `~/.pixel-agents/layout.json`
改為：`~/.pixel-agents/floors/{floorId}/layout.json`

```
~/.pixel-agents/
  building.json              ← 大樓結構（樓層清單、名稱、綁定）
  floors/
    lobby/layout.json        ← 1F 大廳佈局
    floor-2/layout.json      ← 2F 佈局
    floor-3/layout.json      ← 3F 佈局
    ...
  persisted-agents.json      ← 不變（代理外觀全域共用）
  project-names.json         ← 不變
  excluded-projects.json     ← 不變
  settings.json              ← 不變
```

**改動：**
- `readLayoutFromFile(floorId?)` — 讀取指定樓層佈局
- `writeLayoutToFile(layout, floorId?)` — 寫入指定樓層佈局
- 遷移邏輯：首次啟動時，將現有 `layout.json` 遷移為大廳佈局
- 每個新樓層使用 `default-layout.json` 初始化

### A3. Socket.IO Room 隔離

**修改檔案：** `web/server/src/index.ts`

目前：`io.emit('message', msg)` 全域廣播
改為：`io.to('floor:' + floorId).emit('message', msg)`

**實作步驟：**
1. 客戶端連線時加入預設房間（大廳）
2. 新增 `joinFloor` / `leaveFloor` 訊息處理
3. `ctx.sender` 改為樓層範圍廣播函式
4. `directSender` 不變（仍為單播）
5. 素材載入（精靈圖、家具目錄）保持全域廣播（所有樓層共用）

**新增訊息類型：**
```typescript
// 客戶端 → 伺服器
| { type: 'joinFloor'; floorId: string }
| { type: 'leaveFloor' }

// 伺服器 → 客戶端
| { type: 'floorJoined'; floor: Floor; agents: AgentInfo[] }
| { type: 'buildingOverview'; floors: FloorSummary[] }
| { type: 'floorSummaryUpdate'; floorId: string; agentCount: number; activity: string }
```

### A4. 代理 ↔ 樓層映射

**修改檔案：** `web/server/src/agentManager.ts`、`web/server/src/fileWatcher.ts`

目前：所有代理在全域 Map 中
改為：`AgentState` 新增 `floorId` 欄位

**映射邏輯：**
1. 自動偵測到新代理 → 查詢 `building.json` 中專案目錄對應的樓層
2. 有映射 → 代理分配到該樓層
3. 無映射 → 代理出現在大廳（1F）
4. `agentCreated` 訊息只廣播到該樓層的 room

**改動量：**
- `AgentState` 加 `floorId: string`
- `createAgent()` 時根據 `projectDir` 查找樓層
- `removeAgent()` 時從對應樓層 room 廣播
- `ensureProjectScan()` 的自動收養邏輯加入樓層分配

### A5. 客戶端樓層切換支援

**修改檔案：** `web/client/src/hooks/useExtensionMessages.ts`、`web/client/src/office/engine/officeState.ts`

**改動：**
- `joinFloor(floorId)` — 發送 joinFloor → 收到新佈局 + 代理列表 → 重建 OfficeState
- `leaveFloor()` — 離開當前房間
- 切換樓層時：清除當前代理 → 載入新佈局 → 重新放置角色
- `OfficeState` 加 `currentFloorId` 欄位

**關鍵注意：** 切換樓層時需要清除 canvas 並重新渲染，類似重新載入但不斷線。

---

## 階段 B — 大樓 UI

> 預估工作量：16-20 小時
> 前置條件：階段 A 完成

### B1. BuildingView 電梯面板元件

**新增檔案：** `web/client/src/components/BuildingView.tsx`

像素藝術風格的電梯面板，左側或底部顯示：

```
┌─────────────────────────┐
│  🏢 AI 研發大樓          │
├─────────────────────────┤
│  [5F] 🔒 私人辦公室  ●   │  ← ● = 活躍指示燈
│  [4F] 🎨 前端專案    ●●  │  ← ●● = 2 個活躍代理
│  [3F] 🔧 後端工程    ●●● │
│  [2F] ☕ 休息室           │
│  [1F] 🏛️ 大廳       ●   │  ← 當前所在樓層高亮
├─────────────────────────┤
│  [+] 新增樓層            │
└─────────────────────────┘
```

**設計要點：**
- 像素藝術風格（`--pixel-*` CSS 變數）
- 每層顯示：樓層號、名稱、活躍代理數（彩色圓點）
- 當前樓層高亮
- 點擊切換樓層（觸發 joinFloor）
- 底部「新增樓層」按鈕
- 可收合（節省空間）

### B2. 大廳（1F）特殊視圖

**新增檔案：** `web/client/src/components/LobbyView.tsx`

大廳是總覽頁，像像素藝術儀表板：

```
┌─────────────────────────────────────────┐
│  🏛️ 大廳 — 所有樓層狀態                 │
├────────────┬────────────┬───────────────┤
│ 3F 後端    │ 4F 前端    │ 5F 私人       │
│ ●●● 活躍   │ ●● 活躍    │ ● 閒置       │
│ 3 個代理   │ 2 個代理   │ 1 個代理      │
│ [前往 →]   │ [前往 →]   │ [前往 →]      │
└────────────┴────────────┴───────────────┘
```

- 顯示每個樓層的迷你摘要卡片
- 即時更新代理數量和活躍狀態
- 點擊「前往」跳轉到該樓層
- 未綁定專案的流浪代理在大廳漫遊

### B3. 樓層管理 UI

**修改檔案：** `web/client/src/components/SettingsModal.tsx` 或獨立元件

功能：
- 新增/刪除樓層
- 修改樓層名稱（雙擊改名，類似 AgentLabels）
- 綁定/解綁專案到樓層
- 樓層排序（拖曳或上下箭頭）
- 匯出/匯入單層佈局

### B4. 樓層切換動畫

**修改檔案：** `web/client/src/office/engine/renderer.ts` 或新增動畫元件

簡單的切換特效：
- 方案 A：Matrix 風格（複用現有 matrixEffect.ts）— 綠色雨幕過場
- 方案 B：電梯滑動 — 畫面上下滑出/滑入
- 方案 C：淡入淡出 — 最簡單

建議 V1 用方案 A（已有程式碼可複用）。

### B5. App.tsx 整合

**修改檔案：** `web/client/src/App.tsx`

```
App
├── BuildingView（電梯面板 — 常駐側邊或底部）
├── 條件渲染：
│   ├── currentFloor === lobby → LobbyView
│   └── currentFloor !== lobby → OfficeCanvas（現有引擎）
├── BottomToolbar（不變）
└── SettingsModal（擴充樓層管理）
```

**新增狀態：**
- `currentFloorId: string`
- `buildingOverview: FloorSummary[]`
- `isFloorTransitioning: boolean`

---

## 階段 C — 多機器連線（進階）

> 預估工作量：30-40 小時
> 前置條件：階段 A + B 完成
> 備註：此階段可延後，單機大樓已有完整體驗

### C1. Agent Node CLI

**新增目錄：** `agent-node/`

獨立 Node.js 進程，安裝在遠端開發機上：

```bash
npx pixel-agents-node --server wss://your-server.com --token <jwt>
```

功能：
- 本地監控 `~/.claude/projects/` 的 JSONL
- 用 transcriptParser 解析事件
- 透過 WebSocket 上報到中央伺服器
- 不傳原始 JSONL 內容（隱私保護）

### C2. 簡易認證

**修改檔案：** `web/server/src/index.ts`

- JWT token 認證（Socket.IO middleware）
- 用戶註冊/登入 API（簡易版：暱稱 + 密碼）
- Agent Node 啟動時用 token 認證
- 權限檢查：public 樓層任何人可看，private 樓層需邀請

### C3. 遠端代理渲染

**修改檔案：** `web/client/src/office/engine/renderer.ts`

- 遠端代理加視覺標記（如半透明光暈、不同邊框色）
- 標籤顯示「用戶名 / 代理名」
- 遠端代理不可本地操作（座位分配、權限批准等）

### C4. 中央伺服器強化

**修改檔案：** `web/server/src/index.ts`、`web/server/src/agentManager.ts`

- 接收 Agent Node 的事件上報
- 區分本地代理（子進程）vs 遠端代理（WebSocket 上報）
- 遠端代理的生命週期管理（心跳、超時、斷線清理）

---

## 階段 D — 協作增強（錦上添花）

> 前置條件：階段 A + B 完成即可開始部分功能

### D1. 即時文字聊天（低複雜度）
- 利用現有氣泡系統，新增 `chat` 氣泡類型
- 底部輸入框，訊息廣播到同樓層
- 角色頭上顯示文字氣泡（像素風格）

### D2. 大樓儀表板（中複雜度）
- 獨立頁面，顯示所有樓層/代理/專案的即時狀態
- 統計圖表（今日活躍時間、工具使用分佈）
- 適合投影在團隊螢幕上

### D3. 跨樓層角色走動（中複雜度）
- 角色走到電梯 → 電梯動畫 → 出現在目標樓層
- 需要暫時在兩個 room 中同時存在
- 純視覺效果，不影響代理功能

### D4. 會議室功能（高複雜度）
- 特殊家具「會議桌」
- 多個代理圍坐討論（視覺效果）
- 可能整合多代理對話（需 Claude API 支援）

### D5. 日夜循環（低複雜度）
- Canvas 加全域色溫濾鏡
- 根據真實時間自動切換
- 夜晚：桌燈亮起、窗外變暗

---

## 實施順序建議

```
階段 A（資料基礎）
  A1 樓層模型 → A2 多佈局持久化 → A3 Room 隔離 → A4 代理映射 → A5 客戶端切換
  ↓
階段 B（大樓 UI）
  B1 電梯面板 → B5 App 整合 → B2 大廳視圖 → B3 樓層管理 → B4 切換動畫
  ↓
階段 D（部分可先做）
  D1 文字聊天 → D5 日夜循環
  ↓
階段 C（多機器 — 可延後）
  C2 認證 → C1 Agent Node → C3 遠端渲染 → C4 伺服器強化
  ↓
階段 D（剩餘）
  D2 儀表板 → D3 跨樓層走動 → D4 會議室
```

---

## 風險與注意事項

1. **佈局遷移**：現有用戶的 `layout.json` 需要平滑遷移到新的多樓層結構，不能遺失已編輯的佈局
2. **效能**：多樓層不應增加 CPU 負擔 — 只渲染當前樓層，其他樓層只維護狀態
3. **向後相容**：socketApi.ts 的 postMessage 介面不應變動，減少客戶端修改量
4. **測試策略**：每完成一個子步驟就需要測試，特別是樓層切換時的狀態清理
5. **演示模式**：現有 `--demo` 模式需要適配多樓層（模擬代理分散在不同樓層）

---

## 修改檔案清單

### 階段 A 涉及檔案
| 檔案 | 改動類型 | 說明 |
|------|---------|------|
| `web/server/src/types.ts` | 修改 | 新增 Floor、Building、FloorSummary 介面 |
| `web/server/src/constants.ts` | 修改 | 新增樓層相關常數 |
| `web/server/src/floorManager.ts` | **新增** | 樓層 CRUD、專案映射、持久化 |
| `web/server/src/layoutPersistence.ts` | 修改 | 多樓層佈局讀寫 + 遷移邏輯 |
| `web/server/src/index.ts` | 修改 | Socket.IO room 隔離、新訊息類型 |
| `web/server/src/agentManager.ts` | 修改 | AgentState 加 floorId、代理樓層分配 |
| `web/server/src/fileWatcher.ts` | 修改 | 自動偵測加入樓層分配邏輯 |
| `web/client/src/types/messages.ts` | 修改 | 新增樓層相關訊息類型 |
| `web/client/src/hooks/useExtensionMessages.ts` | 修改 | 處理樓層切換、floorJoined 等訊息 |
| `web/client/src/office/engine/officeState.ts` | 修改 | 加 currentFloorId、樓層切換重建邏輯 |
| `web/client/src/App.tsx` | 修改 | 新增樓層狀態、條件渲染 |

### 階段 B 涉及檔案
| 檔案 | 改動類型 | 說明 |
|------|---------|------|
| `web/client/src/components/BuildingView.tsx` | **新增** | 電梯面板元件 |
| `web/client/src/components/LobbyView.tsx` | **新增** | 大廳總覽元件 |
| `web/client/src/components/FloorManager.tsx` | **新增** | 樓層管理 UI |
| `web/client/src/components/BottomToolbar.tsx` | 修改 | 整合大樓按鈕 |
| `web/client/src/components/SettingsModal.tsx` | 修改 | 樓層管理入口 |
| `web/client/src/App.tsx` | 修改 | 整合 BuildingView + LobbyView |
| `web/client/src/i18n.ts` | 修改 | 新增樓層相關繁體中文字串 |
| `web/client/src/index.css` | 修改 | 電梯面板、大廳卡片的像素風格樣式 |
