# OnlinePixelAgents

像素藝術辦公室，讓你的 AI 程式代理在瀏覽器中變成動畫角色。

基於 [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents)（VS Code 擴充套件）改造為獨立 Web 應用，透過 Express + Socket.IO 伺服器自動偵測本機執行中的 Claude Code 會話，無需 VS Code。

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## 功能

- **一個代理，一個角色** — 每個 Claude Code 會話對應一個動畫像素角色
- **即時狀態追蹤** — 角色動畫反映代理實際操作（撰寫、閱讀、執行指令）
- **自動偵測** — 伺服器自動掃描 `~/.claude/projects/` 目錄，發現執行中的 Claude Code 會話
- **專案排除管理** — 可在工作階段選擇器中隱藏不想追蹤的專案資料夾
- **自訂專案名稱** — 雙擊代理標籤自訂顯示名稱，持久化於設定檔
- **工作階段瀏覽** — 搜尋、篩選、恢復過去的 Claude Code 會話
- **辦公室佈局編輯器** — 內建編輯器設計地板、牆壁和家具
- **對話氣泡** — 視覺提示：代理等待輸入或需要授權
- **10 種表情系統** — 閒置行為與 JSONL 偵測觸發的像素表情動畫
- **工具顏色編碼** — 依工具類型自動著色，一目了然
- **工具耗時追蹤** — 即時顯示每個工具的執行時間
- **音效通知** — 代理完成回合時的可選提示音
- **子代理視覺化** — Task 工具的子代理以獨立角色呈現，帶光暈特效
- **佈局持久化** — 辦公室設計儲存於 `~/.pixel-agents/layout.json`
- **演示模式** — 無需實際 Claude 會話，使用 `--demo` 旗標測試 UI
- **繁體中文介面** — 內建 i18n 本地化支援
- **6 種多元角色** — 超過 6 個代理時自動套用色相偏移

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## 需求

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 已安裝並設定

## 快速開始

### Web 版本（推薦）

```bash
git clone https://github.com/RD-CAT/OnlinePixelAgents.git
cd OnlinePixelAgents/web
npm install
npm run build
npm start
```

瀏覽器開啟 `http://localhost:3000`。

### 開發模式

```bash
cd web
npm run dev
```

同時啟動 Vite 開發伺服器（客戶端熱重載）和 tsx watch（伺服器熱重載）。

### 演示模式

無需 Claude Code，純 UI 測試：

```bash
cd web/server
node dist/index.js --demo
# 或指定代理數量
DEMO_AGENTS=5 node dist/index.js --demo
```

### 使用方式

1. 啟動 Web 伺服器後開啟瀏覽器
2. 伺服器會自動掃描並偵測本機執行中的 Claude Code 會話
3. 偵測到的會話自動顯示為辦公室中的動畫角色
4. 點擊角色選取，再點擊座位重新指定位置
5. 點擊 **佈局** 開啟辦公室編輯器自訂空間
6. 點擊 **工作階段** 瀏覽和恢復過去的會話
7. 在工作階段面板底部的「專案資料夾」管理要追蹤的專案

## 架構

```
web/
  server/                     — Express + Socket.IO 伺服器 (Node.js)
    src/
      index.ts                — 入口：Express 靜態檔案 + Socket.IO 連線處理
      agentManager.ts         — 代理生命週期：自動偵測、會話恢復、清理
      fileWatcher.ts          — fs.watch + 輪詢、JSONL 增量讀取、自動收養
      transcriptParser.ts     — JSONL 解析 → Socket.IO 訊息
      assetLoader.ts          — PNG 解析、精靈圖轉換、家具目錄載入
      layoutPersistence.ts    — ~/.pixel-agents/layout.json 讀寫
      projectNameStore.ts     — 自訂專案名稱 + 專案排除清單持久化
      sessionScanner.ts       — 工作階段掃描（瀏覽過去會話）
      timerManager.ts         — 等待/權限計時器
      tmuxManager.ts          — tmux 會話管理與健康檢查
      demoMode.ts             — 演示模式：模擬代理行為序列
      constants.ts            — 伺服器常數（計時、截斷、解析、端口）
      types.ts                — 共享介面 (AgentState, MessageSender, ClientMessage)

  client/                     — React + TypeScript (Vite)
    src/
      App.tsx                 — 組合根：hooks + components + EditActionBar
      socketApi.ts            — Socket.IO ↔ postMessage 相容層
      i18n.ts                 — 繁體中文本地化字串
      constants.ts            — 網格/動畫/渲染/相機/縮放/遊戲邏輯常數
      notificationSound.ts   — Web Audio API 提示音
      hooks/
        useExtensionMessages.ts — Socket.IO 訊息 → officeState 同步
        useEditorActions.ts     — 編輯器狀態 + 回呼
        useEditorKeyboard.ts    — 快捷鍵綁定
      components/
        BottomToolbar.tsx      — 工作階段、佈局切換、設定按鈕
        SessionPicker.tsx      — 工作階段瀏覽器 + 專案資料夾管理
        SettingsModal.tsx      — 設定、匯出/匯入佈局、音效切換
        AgentLabels.tsx        — 代理名稱標籤（可雙擊改名）
        ZoomControls.tsx       — +/- 縮放（右上角）
        DebugView.tsx          — 除錯覆蓋層
        ErrorBoundary.tsx      — React 錯誤邊界
      office/                 — 遊戲引擎（渲染、角色 FSM、BFS 尋路）
        types.ts              — 遊戲型別定義（EmoteType, CharacterState 等）
        toolUtils.ts          — 工具名稱解析、顏色編碼
        colorize.ts           — 著色/調整模組
        sprites/              — spriteData.ts, spriteCache.ts
        editor/               — editorActions.ts, editorState.ts, EditorToolbar.tsx
        layout/               — furnitureCatalog.ts, layoutSerializer.ts, tileMap.ts
        engine/               — characters.ts, officeState.ts, gameLoop.ts, renderer.ts, matrixEffect.ts
        components/           — OfficeCanvas.tsx, ToolOverlay.tsx
```

原始 VS Code 擴充套件程式碼保留於根目錄的 `src/` 和 `webview-ui/`。

## 佈局編輯器

內建編輯器支援：

- **地板** — 7 種花紋 + HSB 色彩控制
- **牆壁** — 自動拼接 + 色彩自訂
- **工具** — 選取、繪製、擦除、放置、吸管、拾取
- **撤銷/重做** — 50 層歷史 Ctrl+Z / Ctrl+Y
- **匯出/匯入** — 透過設定面板以 JSON 格式分享佈局

網格可擴展至 64×64 格。

## 辦公室素材

辦公室圖磚使用 **[Office Interior Tileset (16x16)](https://donarg.itch.io/officetileset)** by **Donarg**（itch.io，$2 USD）。

此為專案中唯一非免費部分，圖磚未包含在倉庫中。購買後執行素材導入管線：

```bash
npm run import-tileset
```

無圖磚時仍可運作 — 會有預設角色和基礎佈局，但完整家具目錄需要導入的素材。

## 技術棧

- **Web 伺服器**: Node.js, Express 5, Socket.IO 4, TypeScript, pngjs
- **Web 客戶端**: React 19, TypeScript, Vite 7, Canvas 2D, Socket.IO Client
- **原始擴充**: TypeScript, VS Code Webview API, esbuild

## 致謝

本專案基於 [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents)，以 MIT 授權條款釋出。感謝原作者 [Pablo De Lucca](https://github.com/pablodelucca) 的出色作品。

## 授權條款

本專案以 [MIT License](LICENSE) 授權。
