# OnlinePixelAgents 專案檢視與優化建議

日期：2026-03-02
範圍：`web`（server/client）與整體 repo 結構

## 檢查摘要
- `web` TypeScript typecheck：通過
- `web` lint：失敗（2 errors, 13 warnings）
- `web` test：失敗（`transcriptParser` 6 tests failed）

## 主要問題（依嚴重度）

### 1) 安全風險：預設帳密 admin/admin
- 位置：`web/server/src/auth/userStore.ts`
- 現況：首次啟動若無使用者會自動建立 `admin/admin`
- 風險：弱密碼預設帳號易被未授權使用
- 建議：改為首次啟動強制建立帳號，或生成一次性隨機密碼並要求立即更改

### 2) 安全風險：主 Socket 通道缺乏認證與授權
- 位置：`web/server/src/index.ts`
- 現況：Socket 連線進來即可發送控制訊息（如 close/resume/save）
- 風險：若服務可被網路存取，可能被任意控制
- 建議：
  - Socket 連線加入 JWT 驗證中介層
  - 對管理操作加上角色與擁有權檢查
  - 視需要將預設監聽改為 `127.0.0.1`

### 3) 回歸問題：測試 context 與程式介面不一致
- 位置：
  - `web/server/src/transcriptParser.ts`
  - `web/server/tests/transcriptParser.test.ts`
- 現況：`processTranscriptLine` 使用 `ctx.floorSender(...)`，測試 mock 未提供此方法
- 結果：6 個測試失敗（TypeError: floorSender is not a function）
- 建議：更新測試 mock context，補齊 `floorSender`（與必要欄位）

### 4) CI 阻斷：React purity lint error
- 位置：
  - `web/client/src/components/AgentTimeline.tsx`
  - `web/client/src/components/AgentDetailPanel.tsx`
- 現況：render 期間直接呼叫 `Date.now()`
- 結果：lint error，CI 失敗
- 建議：
  - 透過外部 tick state / effect 提供 `now`
  - 或抽離至可控時間來源，避免 render 呼叫 impure function

### 5) 文件與腳本不一致
- 位置：
  - `README.md`
  - 根目錄 `package.json`
- 現況：README 建議 `npm run import-tileset`，但 script 指向不存在檔案 `scripts/import-tileset-cli.ts`
- 建議：修正 script 或 README，使指令可直接執行

### 6) 維護性風險：大型檔案與責任混合
- 觀察：
  - `web/server/src/index.ts` 約 1087 行
  - `web/client/src/hooks/useExtensionMessages.ts` 約 753 行
  - `web/client/src/App.tsx` 約 614 行
- 風險：高耦合、測試難、回歸率高
- 建議：依領域切分模組（auth/floor/chat/terminal/settings/message handlers）

### 7) 架構分叉風險：雙前端程式碼庫重疊
- 位置：`web/client/src` 與 `webview-ui/src`
- 現況：至少 39 個同名檔案且內容已有差異
- 風險：功能修正需雙邊同步，容易漏改
- 建議：定義單一來源（single source of truth）或抽 shared package

## 技術隱憂與風險
- **循環依賴 (Circular Dependency)**：`index.ts` 拆分時若無定義清晰的依賴層次（如引入事件驅動架構），極易導致 TypeScript 循環引用錯誤。
- **通訊協議差異**：`web/client` (Socket.io) 與 `webview-ui` (postMessage) 底層協議不同，單純抽離 Core 邏輯不足以解決問題，需實作通訊抽象層 (Transport Layer)。
- **開發便利性 vs 安全性**：全面實作 JWT 認證可能增加本地開發除錯門檻，需考慮開發模式下可降級（如 `AUTH_ENABLED=false`）或使用 VS Code Token 的機制。
- **效能回歸 (Performance Regression)**：重構大檔時可能導致 Phase 6 的快取（LRU）或 indexing 優化邏輯失靈，需建立基礎效能測試。

## 優先執行建議（Roadmap）
1. 修安全基線：移除預設弱帳密、加入 socket 認證與授權
2. 修 CI 紅燈：補測試 mock + 修 React purity errors
3. 修文件/腳本一致性：確保 README 指令可用
4. 拆分大型模組：先從 `index.ts` 與 `useExtensionMessages.ts` 開始
5. 收斂雙前端架構：定義共用核心與差異層

## 可量化目標（驗收）
- CI 全綠（typecheck/lint/test/build）
- 高風險安全問題 0 件（預設弱帳密、未授權控制）
- 大型檔案平均行數下降（核心檔拆分）
- 重複模組數下降（web/client vs webview-ui）
- 跨端通訊層 (Transport Layer) 介面定義完成
