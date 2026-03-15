# OnlinePixelAgents 改善分析報告

> 分析日期：2026-02-26
> 分析範圍：web/server、web/client、專案基礎設施

---

## 目錄

- [一、高優先 — 穩定性與安全性](#一高優先--穩定性與安全性)
- [二、中優先 — 效能優化](#二中優先--效能優化)
- [三、中優先 — 功能缺口](#三中優先--功能缺口)
- [四、中優先 — 程式碼品質](#四中優先--程式碼品質)
- [五、基礎設施問題](#五基礎設施問題)
- [六、低優先 — 無障礙性與 UX 打磨](#六低優先--無障礙性與-ux-打磨)
- [執行順序建議](#執行順序建議)

---

## 一、高優先 — 穩定性與安全性

### 1. 檔案描述符洩漏風險

**檔案：** `web/server/src/fileWatcher.ts`、`web/server/src/sessionScanner.ts`

`fs.openSync` / `fs.readSync` / `fs.closeSync` 未用 `try/finally` 保護。若 `readSync` 拋出例外（例如讀取期間檔案被刪除），fd 永遠不會被關閉，造成檔案描述符洩漏。

```typescript
// 目前（危險）
const fd = fs.openSync(agent.jsonlFile, 'r');
fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
fs.closeSync(fd);

// 修正方向
const fd = fs.openSync(agent.jsonlFile, 'r');
try {
  fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
} finally {
  fs.closeSync(fd);
}
```

**影響：** 長時間運行後可能耗盡系統檔案描述符限制，導致伺服器無法開啟新檔案。

---

### 2. tmux spawn 缺少錯誤處理

**檔案：** `web/server/src/tmuxManager.ts`（`createTmuxSession`）

呼叫 `spawn('tmux', ...)` 後直接 `tmux.unref()`，沒有 `error` 事件監聽器。若 tmux 未安裝或 session 名稱衝突，將產生 Node.js 未處理的 `'error'` 事件，可能讓整個進程崩潰。

**修正方向：** 加上 `tmux.on('error', (err) => { ... })` 或改用 `execSync` 搭配 try/catch。

---

### 3. Demo 模式 Timer 孤兒

**檔案：** `web/server/src/demoMode.ts`（第 70-144 行）

`agent.timer` 在 `runToolSequence` 中被多次覆寫，每次覆寫前的 timer 變成孤兒。`stopDemoMode` 只能清除最後一個 `agent.timer`，前面的 timer 永遠不會被清除。

```typescript
// 目前
agent.timer = setTimeout(() => { ... }, delay);
// ... 後面又
agent.timer = setTimeout(() => { ... }, delay); // 前一個 timer 遺失

// 修正方向：改用陣列收集
agent.timers: ReturnType<typeof setTimeout>[] = [];
agent.timers.push(setTimeout(() => { ... }, delay));
// stop 時：agent.timers.forEach(clearTimeout)
```

**影響：** 記憶體洩漏，且停止 demo 模式後仍有殘留的 timer 觸發。

---

### 4. 代理清理邏輯分散不一致

**檔案：** `web/server/src/fileWatcher.ts`（`checkStaleAgents` 第 214-236 行）

代理的「清理」邏輯出現在 5 個不同位置：

| 位置 | 檔案 |
|------|------|
| `removeAgent` | `agentManager.ts` |
| `closeAgent` | `agentManager.ts` |
| `checkStaleAgents` | `fileWatcher.ts` |
| `checkTmuxHealth` | `agentManager.ts` |
| `spawnClaudeAgent` exit handler | `agentManager.ts` |

其中 `checkStaleAgents` 自行實作了 6 行重複的清理程式碼，未呼叫統一的 `removeAgent`。

**修正方向：** 所有清理路徑統一呼叫 `removeAgent()`。

---

### 5. 多 Client 重入問題

**檔案：** `web/server/src/index.ts`（`webviewReady` handler）

`recoverTmuxAgents` 沒有重入保護。多個瀏覽器分頁同時連入時，每個都觸發 `webviewReady`，導致 `recoverTmuxAgents` 重複執行、重複建立代理。

`ensureProjectScan` 有 `if (projectScanTimerRef.current) return;` 保護，但 `recoverTmuxAgents` 缺少類似機制。

**修正方向：** 加入 `tmuxRecoveredRef` 旗標，確保只執行一次。

---

### 6. 缺少 React Error Boundary

**檔案：** `web/client/src/main.tsx`

整個應用沒有 Error Boundary。任何子元件的渲染錯誤（例如家具目錄解析失敗、精靈圖資料異常）都會導致整個 UI 白屏崩潰，使用者無法操作也看不到任何錯誤訊息。

**修正方向：** 建立 `ErrorBoundary` 元件包裹 `<App />`，顯示友好的錯誤畫面和重試按鈕。

---

### 7. 鍵盤快捷鍵在 input 中誤觸

**檔案：** `web/client/src/hooks/useEditorKeyboard.ts`（第 16-59 行）

鍵盤 handler 附加在 `window` 上，未檢查事件來源元素。在設定 Modal 的 input 中輸入文字時：
- `r` 鍵觸發家具旋轉
- `t` 鍵觸發狀態切換
- `Delete` / `Backspace` 刪除選中的家具

```typescript
// 修正方向：handler 開頭加入
if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
```

---

## 二、中優先 — 效能優化

### 8. AgentLabels + ToolOverlay 各跑獨立 rAF 迴圈

**檔案：**
- `web/client/src/components/AgentLabels.tsx`（第 38-46 行）
- `web/client/src/office/components/ToolOverlay.tsx`（第 66-74 行）

兩個元件各自啟動 `requestAnimationFrame` 迴圈，每幀觸發 `setTick(n => n+1)` 強制 React 重渲染。加上 canvas 遊戲迴圈，共三條 rAF 並行。即使所有代理靜止，每秒仍有 120 次不必要的 React diff。

**修正方向：**
- 整合為單一 rAF 迴圈，透過共享 tick 計數器或訂閱機制通知各元件
- 或改用 CSS transform 做位置移動，避免每幀觸發 React 重渲染

---

### 9. OfficeCanvas useEffect 依賴 zoom 觸發遊戲迴圈重建

**檔案：** `web/client/src/office/components/OfficeCanvas.tsx`（第 234 行）

```typescript
}, [officeState, resizeCanvas, isEditMode, editorState, _editorTick, zoom, panRef])
```

`zoom` 和 `_editorTick` 變化時整個 `useEffect` 重新執行，包括停止舊遊戲迴圈並啟動新的，造成畫面閃爍。

**修正方向：** 使用 `useRef` 傳遞 zoom 等動態值進 render callback，避免 effect 依賴變化觸發迴圈重建。

---

### 10. BFS 路徑尋找效能差

**檔案：** `web/client/src/office/layout/tileMap.ts`（第 48-99 行）

兩個效能問題：

1. **字串 key**：`const key = (c, r) => \`${c},${r}\`` 每次 BFS 都產生數千個臨時字串，加重 GC
2. **Array.shift()**：`queue.shift()` 是 O(n) 操作，大地圖（64×64）上 BFS 變 O(n²)

```typescript
// 修正方向
// 1. 改用整數 key
const key = (c: number, r: number) => r * cols + c;
// 2. 改用指標式 FIFO
let head = 0;
const curr = queue[head++]; // O(1) 出隊
```

---

### 11. 靜態磚塊每幀全量重繪

**檔案：** `web/client/src/office/engine/renderer.ts`（第 46-91 行）

`renderTileGrid()` 每幀重繪所有磚塊。預設地圖 220 格，最大地圖 4096 格。地板磚是完全靜態的。

**修正方向：** 將靜態地板預渲染到離屏 canvas，每幀只做一次 `drawImage(offscreenCanvas)` 即可。布局變更時才重建離屏 canvas。

---

### 12. 同步阻塞 PNG 解析

**檔案：** `web/server/src/assetLoader.ts`（第 110-125 行）

```typescript
for (const asset of catalog) {
  const pngBuffer = fs.readFileSync(assetPath);  // 同步阻塞
  const spriteData = pngToSpriteData(pngBuffer, asset.width, asset.height);
}
```

雖然函式宣告為 `async`，內部對每個家具 PNG 使用 `readFileSync` + `PNG.sync.read`，100+ 個家具時長時間卡住 event loop。同樣問題存在於 `loadWallTiles`、`loadFloorTiles`、`loadCharacterSprites`。

**修正方向：** 改用 `fs.promises.readFile` + `Promise.all` 平行讀取。

---

### 13. knownJsonlFiles 只增不減

**檔案：** `web/server/src/index.ts`（第 38 行）、`web/server/src/fileWatcher.ts`（第 152 行）

代理被移除後其 JSONL 路徑未從 Set 中刪除。語義上代表「已知的 JSONL 檔案」，但 stale 資料：
- 破壞語義（「曾見過的」與「目前活躍的」混為一談）
- 永遠阻止同一 JSONL 被重新採用（例如 `/clear` 後的新會話）

**修正方向：** 在 `removeAgent` 中同步刪除對應的 `knownJsonlFiles` 條目。

---

## 三、中優先 — 功能缺口

### 14. Export Layout 功能已損壞

**檔案：** `web/client/src/components/SettingsModal.tsx`（第 35-43 行）

```typescript
const handleExport = () => {
  vscode.postMessage({ type: 'saveLayout', layout: null }); // 發送 null！
  onClose(); // 靜默關閉，什麼也沒發生
};
```

使用者點擊「匯出佈局」卻什麼也沒發生，無任何提示。`saveLayout: null` 在伺服器端可能造成錯誤。

**修正方向：**
1. 新增 `requestLayout` 訊息類型，伺服器回傳當前佈局 JSON
2. 客戶端收到後用 `<a download>` 或 `Blob` + `URL.createObjectURL` 觸發瀏覽器下載

---

### 15. Socket 斷線無通知

**檔案：** `web/client/src/socketApi.ts`

Socket.IO 客戶端未暴露 `connect` / `disconnect` / `reconnect` 事件給 UI。伺服器斷線時 UI 看起來正常，但所有操作靜默失敗。

**修正方向：** 監聽連線事件，在 UI 頂部顯示連線狀態指示器（類似「已斷線，重連中...」）。

---

### 16. agentDetached 訊息未處理

**檔案：** `web/client/src/office/engine/officeState.ts`（`setAgentDetached` 方法）、`web/client/src/hooks/useExtensionMessages.ts`

`officeState` 有 `setAgentDetached()` 方法，但 `useExtensionMessages` 中無對應的 `msg.type === 'agentDetached'` 處理。代理的 `isDetached` 狀態可能永遠不會被正確設定。

**修正方向：** 在訊息 handler 中加入 `agentDetached` case。

---

### 17. SettingsModal 無法用 Escape 關閉

**檔案：** `web/client/src/components/SettingsModal.tsx`

Modal 沒有監聽 Escape 鍵，違反 UI 慣例。也缺少 `role="dialog"`、`aria-modal` 等無障礙屬性。

---

### 18. SessionPicker 缺少搜尋/過濾功能

**檔案：** `web/client/src/components/SessionPicker.tsx`

會話數量多時只能手動滾動，沒有搜尋框或按 projectDir 分組的機制。

---

## 四、中優先 — 程式碼品質

### 19. 參數地獄（最大架構問題）

**檔案：** `web/server/src/agentManager.ts`

幾乎所有函式都傳入 7-12 個 Map 參數：

```typescript
// 範例：spawnClaudeAgent 接受 12 個參數
function spawnClaudeAgent(
  args, agentId, agents, fileWatchers, pollingTimers, waitingTimers,
  permissionTimers, jsonlPollTimers, nextAgentIdRef, sender, persistAgents, knownJsonlFiles
)
```

**修正方向：** 封裝成 context 物件：

```typescript
interface AgentContext {
  agents: Map<number, AgentState>;
  nextAgentIdRef: { current: number };
  fileWatchers: Map<number, fs.FSWatcher>;
  pollingTimers: Map<number, ReturnType<typeof setInterval>>;
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
  jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>;
  sender: MessageSender | undefined;
  persistAgents: () => void;
  knownJsonlFiles: Set<string>;
}
```

---

### 20. formatModelName 重複定義

**檔案：**
- `web/client/src/components/AgentLabels.tsx`（第 8-14 行）
- `web/client/src/office/components/ToolOverlay.tsx`（第 10-16 行）

完全相同的函式複製了兩份。應抽取到共用的 utils 檔案。

---

### 21. 魔術數字未使用常數

| 位置 | 值 | 應使用的常數 |
|------|----|-------------|
| `transcriptParser.ts` 第 263 行 | `300` | `TOOL_DONE_DELAY_MS` |
| `sessionScanner.ts` 第 6-8 行 | `80`, `16384`, `50` | 應移至 `constants.ts` |

---

### 22. Socket.IO 訊息缺乏型別安全

**檔案：** `web/client/src/hooks/useExtensionMessages.ts`

大量 `as` 型別斷言繞過 TypeScript 型別保護：

```typescript
const id = msg.id as number;
const status = msg.status as string;
```

**修正方向：** 使用 discriminated union type guards 或 Zod schema 驗證訊息格式。

---

### 23. CORS 設為萬能寬放

**檔案：** `web/server/src/index.ts`（第 162 行）

```typescript
const io = new Server(httpServer, { cors: { origin: '*' } });
```

允許任何來源的 WebSocket 連線。結合伺服器端缺乏輸入驗證（`saveLayout` / `saveAgentSeats` 直接寫入磁碟），存在安全隱患。

**修正方向：** 限制為 `localhost` 或配置允許的來源列表。

---

## 五、基礎設施問題

### 24. 完全無測試

專案中無任何測試框架、設定檔或測試檔案。

**建議框架：** Vitest（已使用 Vite，整合零配置）

**優先補測試的模組（純邏輯，易測試）：**

| 模組 | 理由 |
|------|------|
| `transcriptParser.ts` | 核心 JSONL 解析邏輯 |
| `layoutSerializer.ts` | 序列化/反序列化 + 版本遷移 |
| `colorize.ts` | 像素著色演算法 |
| `timerManager.ts` | 計時器狀態機 |
| `furnitureCatalog.ts` | 旋轉群組建構 |

---

### 25. 完全無 CI/CD

無 GitHub Actions workflows。最基本的 CI pipeline 應包含：

1. 型別檢查（`tsc --noEmit`）
2. Lint
3. 建置驗證（`npm run build`）
4. 測試

---

### 26. Web 版無 ESLint 設定

根目錄 `eslint.config.mjs` 只針對 VS Code 擴充的 `src/`。`web/client` 和 `web/server` 完全無 lint 覆蓋。

---

### 27. chokidar 已安裝但從未使用

**檔案：** `web/server/package.json`

`chokidar` 宣告為相依套件但 `web/server/src/` 中無任何 import。伺服器改用原生 `fs.watch` + 2 秒輪詢。應移除。

---

### 28. 程式碼格式不一致

| 端 | 縮排 | 分號 |
|----|------|------|
| 客戶端 | 2 空格 | 無 |
| 伺服器 | Tab | 有 |

無 Prettier 設定。建議統一為 2 空格、無分號。

---

### 29. `npm run dev` 使用 shell `&` 並行

**檔案：** `web/package.json`

```json
"dev": "npm run dev:server & npm run dev:client"
```

一端失敗另一端靜默繼續。建議改用 `concurrently --kill-others`。

---

## 六、低優先 — 無障礙性與 UX 打磨

| # | 問題 | 檔案 | 說明 |
|---|------|------|------|
| 30 | ARIA 屬性全面缺失 | 多個元件 | 無 `role`、`aria-*`、`tabIndex` |
| 31 | SessionPicker 寬度固定 480px | `SessionPicker.tsx` | 小螢幕溢出 |
| 32 | i18n 不完整 | `SessionPicker.tsx`、`ToolOverlay.tsx` | 部分字串硬編碼中文 |
| 33 | Canvas 背景色硬編碼 | `OfficeCanvas.tsx` | `'#1E1E2E'` 應用 `var(--pixel-bg)` |
| 34 | colorizeCache 無清理 | `colorize.ts` | `clearColorizeCache()` 從未被呼叫 |
| 35 | zoomCaches 無 LRU | `spriteCache.ts` | 10 個 zoom 級別各自快取 canvas |
| 36 | ToolOverlay hover 效果壞了 | `ToolOverlay.tsx` 第 230-236 行 | `onMouseEnter` 和 `onMouseLeave` 設定相同值 |
| 37 | `getCharacterAt()` 每次排序 | `officeState.ts` 第 673 行 | 每次滑鼠移動都重新分配 + 排序陣列 |
| 38 | `getSeatAtTile()` 線性搜尋 | `officeState.ts` 第 266-271 行 | 應建立 tile→uid 索引 Map |
| 39 | `rebuildFurnitureInstances()` 頻繁重建 | `officeState.ts` 第 519 行 | 每次代理狀態切換都完整重建 |
| 40 | inline `<style>` 在 App.tsx 中 | `App.tsx` 第 217-223 行 | 應移至 CSS 檔案 |
| 41 | `canPlaceFurniture()` 每幀重建 deskTiles | `editorActions.ts` 第 133-146 行 | 編輯模式 ghost preview 效能差 |
| 42 | hex 轉換重複實作 3 處 | `assetLoader.ts` | 應抽取 `rgbToHex()` 工具函式 |
| 43 | `pendingAgents` 閉包變數有競態風險 | `useExtensionMessages.ts` 第 77 行 | 應改用 `useRef` |
| 44 | `handleReset` 邏輯有短暫不一致 | `useEditorActions.ts` 第 289-295 行 | `isDirty` state 與 `editorState.isDirty` 短暫不同步 |
| 45 | `isTrackedByAgent` 是 O(n) 搜尋 | `fileWatcher.ts` 第 89-93 行 | 應直接用 `knownJsonlFiles` Set 判斷 |
| 46 | `@types/node` 版本落後 | `web/server/package.json` | v22 vs 執行環境 Node.js v25 |
| 47 | `renderMatrixEffect()` 逐像素 fillRect | `matrixEffect.ts` | 多角色同時 spawn 時效能差 |
| 48 | `findGitRoot` 無深度限制 | `index.ts` 第 108-116 行 | symlink 循環時無限迴圈 |
| 49 | 觸控設備無右鍵選單替代 | `OfficeCanvas.tsx` | `walkToTile` 依賴 contextmenu |
| 50 | `saveTimerRef` 未在元件卸載時清除 | `useEditorActions.ts` | 計時器可能在卸載後觸發 |

---

## 執行順序建議

```
Phase 1 — 穩定性修復（#1-7）
  ├── 防止崩潰和資源洩漏
  └── 預估工作量：小（每項 15-30 分鐘）

Phase 2 — 基礎設施（#24-29）
  ├── 建立品質防線（測試、CI、Lint）
  └── 預估工作量：中（1-2 天）

Phase 3 — 效能優化（#8-13）
  ├── 離屏 canvas、rAF 整合、BFS 優化
  └── 預估工作量：中（1-2 天）

Phase 4 — 功能補全（#14-18）
  ├── Export Layout、斷線通知、detached 狀態
  └── 預估工作量：中（1-2 天）

Phase 5 — 架構重構（#19-23）
  ├── AgentContext、型別安全、常數整理
  └── 預估工作量：大（2-3 天）

Phase 6 — UX 打磨（#30-50）
  ├── 無障礙、i18n、快取清理
  └── 預估工作量：大（持續改善）
```
