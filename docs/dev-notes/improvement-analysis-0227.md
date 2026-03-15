# OnlinePixelAgents 改善與擴展分析報告

> 分析日期：2026-02-27
> 分析範圍：web/server、web/client 全面程式碼品質 + 功能擴展構想

---

## 目錄

- [一、缺點改善 — 高優先度](#一缺點改善--高優先度)
- [二、缺點改善 — 中優先度](#二缺點改善--中優先度)
- [三、缺點改善 — 低優先度](#三缺點改善--低優先度)
- [四、功能擴展 — 低複雜度（1-2 小時）](#四功能擴展--低複雜度1-2-小時)
- [五、功能擴展 — 中複雜度（半天到一天）](#五功能擴展--中複雜度半天到一天)
- [六、功能擴展 — 高複雜度（多天）](#六功能擴展--高複雜度多天)
- [七、JSONL 未利用資訊](#七jsonl-未利用資訊)
- [建議實施順序](#建議實施順序)

---

## 一、缺點改善 — 高優先度

### 1. Socket.IO 多連線競態條件

**檔案：** `web/server/src/index.ts`

`ctx.sender` 被最後連線的 socket 覆蓋。多客戶端同時連線時，只有最後一個能收到訊息。

**建議：** 改為 `Map<socketId, Socket>` 或使用 Socket.IO 廣播機制：

```typescript
const connectedSockets = new Map<string, Socket>();

io.on('connection', (socket) => {
    connectedSockets.set(socket.id, socket);
    socket.on('disconnect', () => connectedSockets.delete(socket.id));
});
```

---

### 2. 計時器洩漏

**檔案：** `web/server/src/agentManager.ts`

JSONL 輪詢計時器在 `fs.existsSync()` 持續拋出異常時永遠不會被清理。

**建議：** 加入超時上限（如 60 次失敗後移除代理）：

```typescript
let pollAttempts = 0;
const MAX_POLL_ATTEMPTS = 60;

const pollTimer = setInterval(() => {
    pollAttempts++;
    try {
        if (fs.existsSync(agent.jsonlFile)) {
            clearInterval(pollTimer);
            // ...
        } else if (pollAttempts >= MAX_POLL_ATTEMPTS) {
            clearInterval(pollTimer);
            removeAgent(id, ctx);
        }
    } catch {
        if (pollAttempts >= MAX_POLL_ATTEMPTS) {
            clearInterval(pollTimer);
            removeAgent(id, ctx);
        }
    }
}, JSONL_POLL_INTERVAL_MS);
```

---

### 3. 無 Graceful Shutdown

**檔案：** `web/server/src/index.ts`

伺服器終止時未清理計時器、監視器和子進程。

**建議：** 添加 SIGINT/SIGTERM 處理器：

```typescript
async function gracefulShutdown(): Promise<void> {
    // 清除所有計時器
    for (const timer of pollingTimers.values()) clearInterval(timer);
    for (const timer of waitingTimers.values()) clearTimeout(timer);
    for (const timer of permissionTimers.values()) clearTimeout(timer);
    // 關閉監視器、終止進程
    for (const watcher of fileWatchers.values()) watcher.close();
    for (const agent of agents.values()) {
        if (agent.process && !agent.process.killed) agent.process.kill('SIGTERM');
    }
    process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
```

---

### 4. useExtensionMessages 過長

**檔案：** `web/client/src/hooks/useExtensionMessages.ts`

285 行單一函式，20+ 個條件分支，認知複雜度過高。

**建議：** 分解為訊息特定的處理器：

```typescript
const messageHandlers = {
    agentCreated: (msg, os, setters) => { ... },
    agentClosed: (msg, os, setters) => { ... },
    agentToolStart: (msg, os, setters) => { ... },
} as const;
```

預計工作量：2 小時

---

### 5. OfficeState God 物件

**檔案：** `web/client/src/office/engine/officeState.ts`

混合佈局管理、角色管理、子代理生命週期、工具狀態追蹤、氣泡/表情狀態等職責。

**建議：** 分解為專用類別：

```
OfficeState (協調器)
├── LayoutManager (佈局重建、座位)
├── CharacterManager (角色 CRUD、位置)
├── SubagentManager (子代理生命週期)
└── VisualStateManager (氣泡、表情、特效)
```

預計工作量：4 小時

---

## 二、缺點改善 — 中優先度

### 6. 輪詢二重疊加

**檔案：** `web/server/src/fileWatcher.ts`

`fs.watch` + 2s 輪詢同時觸發 `readNewLines()`，缺少節流機制。

**建議：** 添加去重機制：

```typescript
let lastReadTime = Date.now();
const MIN_READ_INTERVAL_MS = 100;

function throttledReadNewLines(): void {
    const now = Date.now();
    if (now - lastReadTime < MIN_READ_INTERVAL_MS) return;
    lastReadTime = now;
    readNewLines(agentId, ctx);
}
```

---

### 7. 專案掃描效率

**檔案：** `web/server/src/fileWatcher.ts`

每秒掃描全部專案目錄，100+ 專案時大量 `readdirSync`。

**建議：** 實現適應性間隔 — 無新代理時逐漸延長掃描間隔（最長 60s），有新收養時重置。

---

### 8. React 不必要重渲染

**檔案：** `web/client/src/App.tsx`

`useExtensionMessages` 回傳 10 個狀態值，任一變化觸發整個 App 重渲染。

**建議：** 將狀態分組為邏輯塊（`useAgents`、`useAssets`），或使用 React Context 分割。

預計工作量：2 小時

---

### 9. DRY 違反 — 重複刪除邏輯

**檔案：** `web/client/src/hooks/useExtensionMessages.ts` 行 117-144

關閉代理時的 5 次相同刪除模式。

**建議：** 提取通用函式：

```typescript
const deleteFromRecord = <T extends Record<number, unknown>>(prev: T, id: number): T => {
    if (!(id in prev)) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
};
```

預計工作量：1 小時

---

### 10. 孤立工具狀態永不清理

**檔案：** `web/server/src/transcriptParser.ts`

若 `turn_duration` 記錄遺失，工具狀態永遠駐留記憶體。

**建議：** 實現基於時間的自動清理（60s 無 `turn_duration` 則強制清除）。

---

### 11. tmux 指令注入風險

**檔案：** `web/server/src/tmuxManager.ts`

`execSync` 含 shell 解析風險。

**建議：** 改用 `spawnSync('tmux', ['kill-session', '-t', sessionName])` 避免 shell 解析。

---

## 三、缺點改善 — 低優先度

### 12. 缺少客戶端訊息型別定義

**檔案：** `web/server/src/index.ts`

`handleClientMessage` 的 `msg` 為 `Record<string, unknown>`，無型別保障。

**建議：** 定義 `ClientMessage` discriminated union。

---

### 13. 日誌缺乏結構化

**檔案：** 全部伺服器檔案

純文字 `console.log`，難以篩選除錯。

**建議：** 實現簡單的結構化日誌（JSON 格式，含 level、module、agentId）。

---

### 14. 缺少 ARIA 標籤

**檔案：** `EditorToolbar.tsx`、`BottomToolbar.tsx`、`ZoomControls.tsx`

按鈕和控制項缺少 `aria-label`、`title`、鍵盤焦點管理。

預計工作量：2 小時

---

### 15. Canvas 尺寸計算重複

**檔案：** `AgentLabels.tsx`、`OfficeCanvas.tsx`

`deviceOffsetX/Y`、`canvasW/H` 計算邏輯在多處重複。

**建議：** 抽為 `useCanvasMetrics` hook。

---

### 16. EditorToolbar 樣式重複

**檔案：** `web/client/src/office/editor/EditorToolbar.tsx`

`btnStyle`、`activeBtnStyle`、`tabStyle`、`activeTabStyle` 高度重複的 CSS-in-JS 物件。

**建議：** 集中到 CSS 類別或共用樣式常數。

預計工作量：1.5 小時

---

## 四、功能擴展 — 低複雜度（1-2 小時）

### A. 代理時間軸（Timeline View）

**描述：** 側欄顯示每個代理的工具執行時間軸。

```
Agent 1: [Read: 2s] [Grep: 5s] [Edit: 12s] ─→ Waiting (2.3s)
Agent 2: [Task] ├─ [Read] [Bash: 8s] [Done] ─→ Active
```

**效益：** 快速掌握各代理的進度和卡點位置。

**實現思路：**
- 擴展 `ToolActivity` 為 `{ toolId, name, status, startTime, endTime?, done }`
- 新增 `AgentTimeline.tsx` 元件
- 集成到 `SettingsModal` 或側欄

**涉及檔案：** `useExtensionMessages.ts`、`messages.ts`、新增 `AgentTimeline.tsx`

---

### B. 快捷批准系統

**描述：** `Space` 快速批准當前代理權限，`Ctrl+A` 批准全部。

**效益：** 多代理場景大幅提速，減少重複點擊。

**實現思路：**
- `useEditorKeyboard.ts` 擴展快捷鍵
- 發送 `grantPermission` 訊息
- UI 氣泡立即消失

**涉及檔案：** `useEditorKeyboard.ts`、`timerManager.ts`、`messages.ts`

---

### C. thinking 深度可視化

**描述：** 長 thinking 區塊（>5s）觸發特殊「深度思考」表情，與普通踱步區別。

**效益：** 利用未使用的 JSONL 資料，視覺上反映代理正在進行複雜推理。

**實現思路：**
- `transcriptParser.ts` 中計算 thinking 區塊長度
- 長 thinking → 發送 `agentEmote: idea`
- 側欄可選顯示摘要

**涉及檔案：** `transcriptParser.ts`、`officeState.ts`

---

## 五、功能擴展 — 中複雜度（半天到一天）

### D. JSONL 概覽面板

**描述：** 側欄即時顯示當前代理的最後 N 條轉錄記錄，支援搜索和時間戳過濾。

```
12:34:56 [USER]      /add-dir src
12:34:58 [ASSISTANT]  thinking...
12:35:02 [ASSISTANT]  tool_use: Read("src/app.tsx")
12:35:05 [USER]      tool_result: 234 lines read
```

**效益：** 調試利器，無需開終端查看 JSONL。

**實現思路：**
- 伺服器 `transcriptParser.ts` 維護每代理最後 10 條記錄隊列
- 透過 `agentTranscriptUpdate` 訊息傳送
- 新增 `TranscriptViewer.tsx` 元件

**涉及檔案：** `transcriptParser.ts`、`types.ts`、新增 `TranscriptViewer.tsx`、`useExtensionMessages.ts`

---

### E. 工具類型視覺編碼

**描述：** 不同工具類型用不同顏色脈動表示。

| 工具類別 | 顏色 |
|---------|------|
| 讀取（Read/Grep） | 藍色 |
| 寫入（Edit/Write） | 紅色 |
| 計算（Bash） | 綠色 |
| 網路（WebFetch） | 黃色 |

**效益：** 一眼看出代理當前在做什麼。

**實現思路：**
- `ToolOverlay.tsx` 根據工具名稱選擇顏色
- `constants.ts` 定義工具類別 → 顏色映射
- 可選在角色周圍渲染對應色彩脈動

**涉及檔案：** `ToolOverlay.tsx`、`constants.ts`、`renderer.ts`

---

### F. 代理行為編輯器

**描述：** 設定面板中自訂漫遊權重、活動時間等：

```
⚙️ 代理行為
├─ 隨機漫遊: [████░░░░] 30
├─ 家具互動: [██░░░░░░] 15
├─ 聊天社交: [███░░░░░] 10
├─ 坐著休息: [200s]
└─ 伸展間隔: [180s]
```

**效益：** 完全自訂代理個性，不同場景可切換配置。

**實現思路：**
- 新增 `AgentBehaviorEditor.tsx` 含滑桿調整器
- 保存至 localStorage
- 配置實時應用到角色 FSM

**涉及檔案：** 新增 `AgentBehaviorEditor.tsx`、`SettingsModal.tsx`、`characters.ts`、`constants.ts`

---

### G. 實時統計儀表板

**描述：** 側欄顯示即時統計。

```
📊 代理統計
⏱️  平均回合時間: 2.3s
🔧 最常用工具: Bash (45%)
💬 聊天次數: 12
🚶 漫遊距離: 234 tiles
🔄 FPS: 60
```

**效益：** 量化觀察代理活動，效能監控。

**實現思路：**
- `officeState` 記錄指標（回合時間、工具使用計數、漫遊距離）
- gameLoop 計算 FPS
- React 元件每 1s 刷新

**涉及檔案：** `officeState.ts`、新增 `StatsDashboard.tsx`、`App.tsx`

---

### H. 漫遊行為智能化

**描述：** 讓角色漫遊更像真人。

- 同事感知避讓：降低經過工作中角色座位的權重
- 家具親和度衰減：每 2-3 分鐘訪問同一家具則吸引力下降 50%
- 座位舒適度動態：久坐後更容易起身，外出久了更想回座位

**效益：** 角色行為更自然，形成「工作節奏」感。

**涉及檔案：** `characters.ts`、`types.ts`（Character 新增欄位）、`constants.ts`

---

## 六、功能擴展 — 高複雜度（多天）

### I. 錄製/回放系統

**描述：** 錄製完整代理會話動畫，支援 2x/4x/8x 回放。

**實現思路：**
- 逐幀記錄狀態差異（delta compression）
- IndexedDB 或伺服器儲存
- 回放控制欄（播放/暫停/速度/進度條）

**涉及檔案：** 新增 `recorder.ts`、`playback.ts`、`PlaybackControls.tsx`、`gameLoop.ts`

預計工作量：2-3 天

---

### J. 代理成長系統

**描述：** 經驗值 + 技能樹，工具使用越多技能越高。

```
Agent 1 ⭐⭐⭐⭐ (Lv. 12)
├─ 閱讀技能: ████████░░ 85%
├─ 編輯技能: ██████░░░░ 65%
├─ Bash 技能: █████░░░░░ 50%
└─ 聊天親和: ███████░░░ 70%
```

**效益：** 遊戲化長期參與，等級徽章可視化。

**涉及檔案：** `officeState.ts`、`transcriptParser.ts`、新增 `AgentStatsPanel.tsx`、`spriteData.ts`

預計工作量：1.5-2 天

---

### K. 日夜循環與環境動態化

**描述：** 背景光照隨模擬時間變化，影響代理行為傾向。

- 白晝（08-17）：明亮背景，代理活躍度高
- 傍晚（17-21）：橙黃色調，漫遊增多
- 深夜（21-08）：深色背景，更易睡眠

**效益：** 環境沉浸感，減少審美疲勞。

**涉及檔案：** 新增 `environmentSystem.ts`、`gameLoop.ts`、`characters.ts`、`renderer.ts`

預計工作量：2-3 天

---

### L. 子代理焦點光暈

**描述：** 子代理角色周圍渲染淡藍色光暈 + 向父代理方向的箭頭指示。

**效益：** 清晰顯示父子代理的層級關係。

**涉及檔案：** `renderer.ts`、`constants.ts`

預計工作量：3-4 小時

---

## 七、JSONL 未利用資訊

| 資訊 | 現狀 | 可利用方式 |
|------|------|-----------|
| `thinking` 區塊長度 | 僅觸發踱步 | 長 thinking → 深度思考表情；側欄摘要 |
| `turn_duration` 時間序列 | 僅清除狀態 | 累積回合速度分析，側欄趨勢圖 |
| `tool_use.input` 參數 | 截斷顯示 | 識別代理領域（測試/構建/閱讀），側欄標籤 |
| `bash_progress.output` | 僅重啟計時器 | 即時顯示 bash 輸出摘要，卡住偵測 |
| `file-history-snapshot` | 完全忽略 | 「涉及文件」清單，代碼熱力圖 |
| `tool_result.content` | 僅標記完成 | 偵測 error → 標記失敗工具（紅色），預覽結果 |

---

## 建議實施順序

### 第一階段：穩定性修復（本週）

| 項目 | 工作量 |
|------|--------|
| Socket.IO 多連線修復 (#1) | 1h |
| Graceful shutdown (#3) | 1h |
| 計時器洩漏防護 (#2) | 1h |

### 第二階段：快速功能（下週）

| 項目 | 工作量 |
|------|--------|
| 代理時間軸 (A) | 2h |
| 快捷批准系統 (B) | 1-2h |
| thinking 深度表情 (C) | 1h |
| DRY 違反修復 (#9) | 1h |

### 第三階段：架構改善 + 中型功能（後續）

| 項目 | 工作量 |
|------|--------|
| useExtensionMessages 拆分 (#4) | 2h |
| JSONL 概覽面板 (D) | 2-3h |
| 工具類型視覺編碼 (E) | 2-3h |
| React 重渲染優化 (#8) | 2h |

### 長期願景

| 項目 | 工作量 |
|------|--------|
| OfficeState 拆分 (#5) | 4h |
| 代理行為編輯器 (F) | 4-6h |
| 錄製/回放系統 (I) | 2-3 天 |
| 代理成長系統 (J) | 1.5-2 天 |
| 日夜循環 (K) | 2-3 天 |
