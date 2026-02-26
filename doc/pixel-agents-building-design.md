# Pixel Agents 多人辦公室大樓 — 架構設計

## 一、概念總覽

將原本的單人 VS Code 擴充套件，改造成一個 **多人即時協作的虛擬辦公室大樓**：

```
┌─────────────────────────────────────────┐
│           🏢 Pixel Agents Tower          │
├─────────────────────────────────────────┤
│  7F  ┊ 🔒 私人辦公室 (個人專案)          │
│  6F  ┊ 🧪 研發部 (ML Pipeline 團隊)      │
│  5F  ┊ 🎨 設計部 (前端重構團隊)          │
│  4F  ┊ 📊 數據分析 (報表自動化專案)       │
│  3F  ┊ 🔧 後端工程 (API 重寫專案)        │
│  2F  ┊ ☕ 公共休息室 / 會議室             │
│  1F  ┊ 🏛️ 大廳 (即時狀態總覽)           │
└─────────────────────────────────────────┘
```

每台電腦執行一個 Agent 節點，所有人的角色和專案狀態即時同步到同一棟大樓中。

---

## 二、原始專案耦合度分析

基於原始碼深度分析，現有模組與 VS Code 的耦合程度如下：

### 🟢 零耦合 — 可直接複用

| 模組 | 檔案 | 說明 |
|------|------|------|
| 像素引擎 | `officeState.ts`, `renderer.ts`, `characters.ts` | Canvas 2D 渲染、BFS 尋路、角色狀態機 |
| 動畫系統 | `sprites/`, `colorize.ts` | 精靈圖、調色盤、色相偏移 |
| 佈局系統 | `layout/`, `editor/` | 地圖序列化、家具目錄、Undo/Redo |
| 地圖元件 | `floorTiles.ts`, `wallTiles.ts` | 地板/牆壁自動拼接 |
| UI 組件 | `components/` | React 組件 (AgentLabels, Toolbar 等) |
| Transcript 解析 | `transcriptParser.ts` | JSONL 解析邏輯 (僅依賴 `path.basename`) |

### 🔴 需要替換

| 模組 | 原始實作 | 多人版替代 |
|------|---------|-----------|
| `vscodeApi.ts` | `acquireVsCodeApi()` | WebSocket client |
| `fileWatcher.ts` | `fs.watch` + polling | Server-side `chokidar` → WebSocket push |
| `agentManager.ts` | `vscode.window.createTerminal()` | `node-pty` 子進程 / SSH remote |
| `layoutPersistence.ts` | VS Code `workspaceState` | PostgreSQL / Redis |
| `PixelAgentsViewProvider.ts` | VS Code Webview API | Express/Fastify HTTP server |

---

## 三、多人版系統架構

```
┌──────────────────────────────────────────────────────────┐
│                    瀏覽器 (多人共用)                       │
│  ┌──────────────────────────────────────────────────┐    │
│  │  React App                                       │    │
│  │  ├── BuildingView (樓層列表 + 電梯動畫)           │    │
│  │  ├── FloorView (單層辦公室 — 複用現有引擎)        │    │
│  │  ├── MiniMap (大樓鳥瞰圖)                        │    │
│  │  └── Dashboard (所有專案/Agent 即時狀態)          │    │
│  └──────────────────┬───────────────────────────────┘    │
└─────────────────────┼────────────────────────────────────┘
                      │ WebSocket (Socket.IO)
                      │
┌─────────────────────▼────────────────────────────────────┐
│                  中央伺服器 (Node.js)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ Room Manager │  │ Agent Router│  │  Auth / Session  │  │
│  │ (樓層=房間)  │  │ (訊息路由)  │  │  (JWT + OAuth)   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────────────┘  │
│         │                │                                │
│  ┌──────▼────────────────▼───────────────────────────┐   │
│  │              State Sync Engine                     │   │
│  │  • 角色位置 (60fps delta broadcast)                │   │
│  │  • Agent 活動狀態 (tool start/done)               │   │
│  │  • 佈局變更 (CRDT 衝突解決)                       │   │
│  └───────────────────────┬───────────────────────────┘   │
│                          │                                │
│  ┌───────────────────────▼───────────────────────────┐   │
│  │              Persistence Layer                     │   │
│  │  PostgreSQL (佈局/用戶) + Redis (即時狀態/Pub-Sub) │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Agent Node  │ │  Agent Node  │ │  Agent Node  │
│  (電腦 A)    │ │  (電腦 B)    │ │  (電腦 C)    │
│              │ │              │ │              │
│ • JSONL 監控 │ │ • JSONL 監控 │ │ • JSONL 監控 │
│ • Transcript │ │ • Transcript │ │ • Transcript │
│   Parser     │ │   Parser     │ │   Parser     │
│ • Claude Code│ │ • Claude Code│ │ • Claude Code│
│   進程管理   │ │   進程管理   │ │   進程管理   │
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## 四、核心資料模型

### 4.1 大樓結構

```typescript
interface Building {
  id: string
  name: string                // "AI 研發大樓"
  floors: Floor[]
  lobby: Floor                // 1F 大廳 — 特殊樓層
  createdBy: string
}

interface Floor {
  id: string
  buildingId: string
  number: number              // 樓層編號
  name: string                // "後端工程部"
  layout: OfficeLayout        // ← 直接複用現有 OfficeLayout 類型
  project?: Project           // 綁定的專案
  accessLevel: 'public' | 'team' | 'private'
  maxOccupancy: number        // 最大可容納角色數
}

interface Project {
  id: string
  name: string                // "API v3 重寫"
  repo?: string               // GitHub repo URL
  floorId: string             // 所在樓層
  team: TeamMember[]
  createdAt: Date
}

interface TeamMember {
  userId: string
  role: 'owner' | 'member' | 'viewer'
  agentIds: number[]          // 該用戶在此專案的 agent 們
}
```

### 4.2 跨機器 Agent 狀態

```typescript
// Agent Node 上報給中央伺服器的狀態
interface AgentReport {
  agentId: string             // 全域唯一 (userId:localId)
  userId: string              // 所屬用戶
  nodeId: string              // 來源機器 ID
  floorId: string             // 所在樓層
  projectId: string           // 所屬專案

  // 從現有 transcriptParser.ts 直接取得的狀態
  status: 'active' | 'waiting' | 'permission' | 'idle'
  activeTools: ToolActivity[]
  currentToolName: string | null
  subagents: SubagentInfo[]

  // 角色在地圖上的狀態 (由伺服器統一管理)
  characterState: {
    palette: number
    hueShift: number
    seatId: string | null
    displayName: string       // 用戶名 or 自訂 Agent 名
  }
}

// 中央伺服器廣播給所有瀏覽器的狀態
interface FloorBroadcast {
  floorId: string
  characters: CharacterSnapshot[]  // 所有角色的位置/動畫
  events: FloorEvent[]             // 本幀事件 (tool start, bubble 等)
}
```

### 4.3 訊息協議

原始碼中已有一套完整的訊息類型 (`useExtensionMessages.ts`)，多人版只需擴充：

```typescript
// === 保留的現有訊息 (webview ↔ extension) ===
type ExistingMessage =
  | { type: 'agentCreated'; id: number }
  | { type: 'agentClosed'; id: number }
  | { type: 'agentStatus'; id: number; status: string }
  | { type: 'agentToolStart'; id: number; toolId: string; status: string }
  | { type: 'agentToolDone'; id: number; toolId: string }
  | { type: 'subagentToolStart'; id: number; parentToolId: string; ... }
  | { type: 'layoutLoaded'; layout: OfficeLayout }
  | { type: 'saveLayout'; layout: OfficeLayout }

// === 新增的多人訊息 ===
type MultiplayerMessage =
  // 樓層管理
  | { type: 'joinFloor'; floorId: string }
  | { type: 'leaveFloor'; floorId: string }
  | { type: 'floorState'; floorId: string; characters: CharacterSnapshot[] }

  // 大樓導覽
  | { type: 'buildingOverview'; floors: FloorSummary[] }
  | { type: 'floorSummary'; floorId: string; occupants: number; activity: string }

  // 遠端 Agent 操作
  | { type: 'remoteAgentCreated'; agentId: string; userId: string; floorId: string }
  | { type: 'remoteAgentStatus'; agentId: string; status: string; tools: ToolActivity[] }

  // 協作功能
  | { type: 'chatMessage'; floorId: string; userId: string; text: string }
  | { type: 'cursorPosition'; userId: string; x: number; y: number }
```

---

## 五、關鍵改造細節

### 5.1 Agent Node（每台電腦執行）

這是最小的改動 — 基本上就是把現有的 `src/` 後端從 VS Code 擴充拆成獨立 Node.js 進程：

```typescript
// agent-node/index.ts — 每台開發者電腦執行
import { WebSocket } from 'ws'
import { watch } from 'chokidar'
import { processTranscriptLine } from './transcriptParser' // ← 直接複用！
import { spawn } from 'child_process'

class AgentNode {
  private ws: WebSocket
  private agents = new Map<string, AgentState>()

  constructor(serverUrl: string, private userId: string) {
    this.ws = new WebSocket(serverUrl)
    this.ws.on('open', () => this.register())
  }

  // 啟動新的 Claude Code Agent
  spawnAgent(projectDir: string, floorId: string) {
    const sessionId = crypto.randomUUID()
    const proc = spawn('claude', ['--session-id', sessionId], { cwd: projectDir })

    const jsonlPath = getJsonlPath(projectDir, sessionId)
    this.watchTranscript(jsonlPath, sessionId, floorId)

    // 上報給中央伺服器
    this.ws.send(JSON.stringify({
      type: 'agentCreated',
      agentId: `${this.userId}:${sessionId}`,
      floorId,
    }))
  }

  // 監控 JSONL — 複用現有 transcriptParser
  private watchTranscript(path: string, agentId: string, floorId: string) {
    let offset = 0
    const watcher = watch(path)
    watcher.on('change', () => {
      const newLines = readNewLinesFrom(path, offset) // 複用 fileWatcher 邏輯
      for (const line of newLines) {
        // processTranscriptLine 的回呼改為 WebSocket send
        const events = parseTranscriptLine(line) // 提取純函式
        for (const event of events) {
          this.ws.send(JSON.stringify({ ...event, agentId, floorId }))
        }
      }
    })
  }
}
```

**改動量：** `transcriptParser.ts` 只需提取成純函式（移除 `vscode.Webview` 參數，改為返回事件陣列）。核心解析邏輯 0 修改。

### 5.2 中央伺服器

```typescript
// server/index.ts
import { Server } from 'socket.io'

const io = new Server(3000, { cors: { origin: '*' } })

// 樓層 = Socket.IO Room
io.on('connection', (socket) => {
  socket.on('joinFloor', (floorId: string) => {
    socket.join(`floor:${floorId}`)
    // 發送該樓層所有角色的目前狀態
    socket.emit('floorState', getFloorState(floorId))
  })

  // Agent Node 上報狀態 → 廣播給同樓層所有瀏覽器
  socket.on('agentStatus', (data) => {
    updateAgentState(data)
    io.to(`floor:${data.floorId}`).emit('remoteAgentStatus', data)
  })

  // 佈局修改 → CRDT 合併 → 廣播
  socket.on('saveLayout', (data) => {
    const merged = mergeLayout(data.floorId, data.layout)
    io.to(`floor:${data.floorId}`).emit('layoutLoaded', { layout: merged })
    persistLayout(data.floorId, merged) // → PostgreSQL
  })
})
```

### 5.3 前端改造

只需替換通訊層，遊戲引擎完全不動：

```typescript
// 替換 vscodeApi.ts → socketApi.ts
import { io, Socket } from 'socket.io-client'

class SocketApi {
  private socket: Socket

  constructor(serverUrl: string) {
    this.socket = io(serverUrl)
  }

  // 與原始 vscode.postMessage 完全相同的介面
  postMessage(msg: unknown) {
    this.socket.emit('message', msg)
  }

  // 與原始 window.addEventListener('message') 相同
  onMessage(handler: (msg: unknown) => void) {
    this.socket.on('message', handler)
  }
}

export const api = new SocketApi('wss://your-server.com')
```

然後在 `useExtensionMessages.ts` 中：
```diff
- import { vscode } from '../vscodeApi.js'
+ import { api } from '../socketApi.js'

  // 所有 vscode.postMessage(...) 替換為 api.postMessage(...)
  // 所有 window.addEventListener('message', ...) 替換為 api.onMessage(...)
```

### 5.4 新增：大樓視圖

```typescript
// 新組件：BuildingView.tsx
const BuildingView = () => {
  const [floors, setFloors] = useState<FloorSummary[]>([])
  const [currentFloor, setCurrentFloor] = useState<string | null>(null)

  return (
    <div className="building">
      {/* 左側：樓層選單（電梯面板風格） */}
      <div className="elevator-panel">
        {floors.map(f => (
          <FloorButton
            key={f.id}
            floor={f}
            occupants={f.activeAgents}      // 即時人數
            activity={f.activityLevel}       // 忙碌程度指示燈
            onClick={() => setCurrentFloor(f.id)}
          />
        ))}
      </div>

      {/* 右側：當前樓層的辦公室 — 直接複用現有 Canvas 引擎 */}
      {currentFloor && (
        <FloorView
          floorId={currentFloor}
          // OfficeState 實例，與原始碼完全相同
        />
      )}

      {/* 底部：迷你大樓鳥瞰圖 */}
      <BuildingMiniMap floors={floors} />
    </div>
  )
}
```

---

## 六、專案 ↔ 樓層 ↔ 團隊的對應模式

### 模式 A：一個專案 = 一個樓層

適合大型專案，每個專案獨佔一整層：

```
5F: [前端專案] — Alice(2 agents) + Bob(1 agent)
4F: [後端專案] — Charlie(3 agents) + Dave(1 agent)
3F: [ML Pipeline] — Eve(1 agent)
```

每個專案的 Agent 們坐在各自的工位上，看得到同事的 Agent 也在忙。

### 模式 B：一個團隊 = 一個樓層（多專案）

適合小團隊，一層樓裡有多個專案區域：

```
3F: [後端團隊]
    ├── 區域 A (API 專案): 3 張桌子
    ├── 區域 B (DB 遷移): 2 張桌子
    └── 休息區: 沙發 + 飲水機
```

用辦公室佈局編輯器（現有功能）將一層樓分成不同區域。

### 模式 C：每個人一間辦公室（私人空間）

```
7F: [私人樓層]
    ├── 701 室: Alice 的所有個人專案
    ├── 702 室: Bob 的所有個人專案
    └── 703 室: Charlie 的所有個人專案
```

---

## 七、技術挑戰與解決方案

### 7.1 即時同步效能

**問題：** 原始引擎以 60fps 更新角色位置，多人廣播會產生大量流量。

**解決方案：** 採用 **權威伺服器 + 客戶端預測** 模式（類似多人遊戲）：

```
伺服器端 (10-20 tick/sec):
  • 維護所有角色的權威位置
  • 計算尋路 (BFS) 和碰撞
  • 廣播 delta 更新 (只傳有變化的角色)

客戶端 (60 fps):
  • 在兩次伺服器 tick 之間做插值 (lerp)
  • 本地角色立即響應，遠端角色平滑追趕
  • 複用現有 updateCharacter() 函式做本地模擬
```

每個 tick 的封包大小估算：
```
每角色: ~40 bytes (id + x + y + state + dir + frame)
10 角色/樓層 × 20 tick/sec = ~8 KB/sec per floor
```
這個流量完全可以接受。

### 7.2 佈局協作衝突

**問題：** 多人同時編輯同一層樓的佈局。

**解決方案：** 兩種策略：

1. **鎖定模式（簡單）：** 同一時間只有一人可進入編輯模式，其他人看到 "X 正在編輯佈局..."
2. **CRDT 模式（進階）：** 用 Yjs 對 `OfficeLayout.tiles[]` 和 `OfficeLayout.furniture[]` 做衝突解決

建議 V1 用鎖定模式，後續再升級。

### 7.3 跨機器 JSONL 監控

**問題：** 每台電腦的 Claude Code 把 JSONL 寫在本地 `~/.claude/projects/`，其他電腦看不到。

**解決方案：** Agent Node 在本地監控，只將**解析後的事件**上傳，不傳原始 JSONL：

```
電腦 A                          中央伺服器
  │                                │
  │ JSONL: {"type":"assistant"..}  │
  │ → transcriptParser 解析        │
  │ → 產生事件: agentToolStart     │
  │ ─── WebSocket ────────────────→│ 廣播給所有瀏覽器
  │                                │
```

好處：流量極小、不洩露原始對話內容、解析邏輯已經寫好。

### 7.4 安全性

```
認證流程:
  1. 用戶登入 → JWT token
  2. Agent Node 用 token 連接 WebSocket
  3. 中央伺服器驗證 token → 確認身份
  4. 加入樓層時檢查 accessLevel (public/team/private)

權限模型:
  • 大樓擁有者: 管理所有樓層
  • 樓層擁有者: 管理佈局、邀請成員
  • 團隊成員: 放置 Agent、編輯自己的座位
  • 訪客: 只能觀看 (唯讀模式)
```

---

## 八、開發路線圖

### Phase 1 — 單人 Web 版 (2-3 週)

最小改動，驗證可行性：

- [ ] 將 `webview-ui/` 改為獨立 Vite 專案
- [ ] 替換 `vscodeApi.ts` → WebSocket client
- [ ] 建立簡單 Express + Socket.IO 伺服器
- [ ] 將 `transcriptParser.ts` 提取為純函式
- [ ] 一台電腦，一個瀏覽器，功能與 VS Code 版相同

**複用率：~90%**（只改通訊層）

### Phase 2 — 多 Agent Node (2-3 週)

支援多台電腦連入：

- [ ] 實作 Agent Node CLI (`npx pixel-agents-node --server wss://...`)
- [ ] 伺服器端角色狀態管理
- [ ] 客戶端插值與遠端角色渲染
- [ ] 基本認證 (JWT)

### Phase 3 — 大樓系統 (3-4 週)

加入多樓層概念：

- [ ] BuildingView 組件 + 電梯動畫
- [ ] 樓層 = Socket.IO Room
- [ ] 佈局持久化 (PostgreSQL)
- [ ] 專案 ↔ 樓層綁定
- [ ] 權限系統 (public/team/private)

### Phase 4 — 協作增強 (持續)

- [ ] 即時文字聊天 (氣泡對話)
- [ ] 佈局協作編輯 (Yjs CRDT)
- [ ] 大樓儀表板 (所有專案狀態總覽)
- [ ] 通知系統 (Agent 完成/需要權限)
- [ ] 自訂角色皮膚/名牌
- [ ] 跨樓層角色走動（去別的團隊串門）
- [ ] 會議室功能（多個 Agent 討論同一問題）

---

## 九、程式碼改動量估算

| 模組 | 行數 (現有) | 改動量 | 說明 |
|------|------------|--------|------|
| `webview-ui/src/office/` | ~1,400 行 | **< 5%** | 遊戲引擎零修改，只加多人 overlay |
| `webview-ui/src/hooks/` | ~400 行 | **~30%** | 替換訊息來源 (vscode → socket) |
| `webview-ui/src/components/` | ~250 行 | **~20%** | 新增 BuildingView, UserList |
| `src/transcriptParser.ts` | ~300 行 | **< 10%** | 提取為純函式，邏輯不變 |
| `src/fileWatcher.ts` | ~250 行 | **~40%** | 從 fs.watch 改為 chokidar，加 WS 上報 |
| 新增：中央伺服器 | — | **~800 行** | Room 管理、狀態同步、持久化 |
| 新增：Agent Node CLI | — | **~400 行** | 獨立進程，連接伺服器 |
| 新增：認證/權限 | — | **~300 行** | JWT + 樓層存取控制 |

**總結：現有 ~2,600 行程式碼中，約 85% 可直接複用。新增約 1,500 行。**

---

## 十、結論

這個改造是 **高度可行** 的，原因：

1. **前後端已解耦** — 現有架構透過 `postMessage` 訊息協議通訊，天然適合替換為 WebSocket
2. **遊戲引擎獨立** — Canvas 渲染、角色系統、尋路演算法完全不依賴 VS Code
3. **解析器可複用** — `transcriptParser.ts` 只用了 `path.basename()`，幾乎是純函式
4. **佈局系統成熟** — 辦公室編輯器、家具目錄、序列化機制都已完整，直接作為每層樓的佈局
5. **多人擴展自然** — 原始的「一個 Agent = 一個角色」模式，天然可以延伸為「多台電腦的多個 Agent = 一棟大樓的多個角色」

最大的技術風險在於 **即時同步效能**，但以像素藝術遊戲的低精度需求（16×16 tile grid），標準的遊戲伺服器 tick 模式完全足夠應付。
