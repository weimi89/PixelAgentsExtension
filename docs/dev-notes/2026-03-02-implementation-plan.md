# OnlinePixelAgents 改善實作計畫（PR 切分版）

日期：2026-03-02
對應文件：`doc/dev-notes/2026-03-02-project-review.md`

## 目標
- 先恢復 CI 全綠
- 先處理高風險安全問題
- 再做結構重構，降低後續回歸成本

## 建議 PR 切分

### PR-1：CI 紅燈快速修復（優先最高）
範圍：`web/server/tests`, `web/client/src/components`

工作項目：
1. 修 `transcriptParser` 測試 mock context
2. 修 React purity lint error（移除 render 內 `Date.now()`）
3. 保持行為不變，僅做最小修復

預估工時：0.5 ~ 1 天

驗收標準：
- `cd web && npm run lint` 通過
- `cd web && npm test` 通過
- `cd web && npm run typecheck` 通過

風險：
- 時間流逝顯示（elapsed）可能受更新頻率影響，需確認 UI 顯示節奏

---

### PR-2：安全基線修復（優先高）
範圍：`web/server/src/auth`, `web/server/src/index.ts`, `web/client`（登入流程若需）

工作項目：
1. 移除預設 `admin/admin` 行為
2. 建立首次啟動初始化流程（CLI 或 env 注入初始管理員）
3. 主 Socket.IO 加入 JWT 驗證
4. **實作 `AUTH_ENABLED` 環境變數，允許在受控本地開發環境下跳過認證**
5. 管理操作加授權檢查（至少 owner/admin）
6. 補安全回歸測試（未授權請求應拒絕）

預估工時：1.5 ~ 3 天

驗收標準：
- 未登入無法建立 socket 控制連線
- 未授權無法執行 `closeAgent/resumeSession/saveLayout` 等高風險操作
- 不再存在預設弱密碼帳號

風險：
- 會影響現有連線流程，需要同步調整 client 初始化

---

### PR-3：文件與腳本一致性（優先中）
範圍：`README.md`, `package.json`, `scripts/`

工作項目：
1. 修正 `import-tileset` 腳本路徑或補齊入口檔
2. README 指令逐條驗證可執行
3. 在 CI 增加 smoke check（至少驗證關鍵 npm script 存在且可啟動）

預估工時：0.5 天

驗收標準：
- README 所列命令可執行
- 無「文件叫你跑但實際不存在」的腳本

---

### PR-4：Server 模組化重構（優先中）
範圍：`web/server/src/index.ts` 拆分

工作項目：
1. 抽出 `socketHandlers/`（按 message type 分檔）
2. 抽出 `bootstrap/`（server startup, io setup, shutdown）
3. 抽出 `terminal/`（terminal ws 生命週期）
4. **引入 `EventEmitter` 或簡單的中介者模式，解決拆分後的循環依賴問題**
5. 保持 API 不變，僅重組程式結構

預估工時：2 ~ 4 天

驗收標準：
- `index.ts` 行數降低至 < 400
- 既有測試全過
- 新增至少 1~2 個 handler 單元測試範例

風險：
- 搬移過程容易出現 import 循環，需先定義依賴方向

---

### PR-5：Client 訊息處理重構（優先中）
範圍：`web/client/src/hooks/useExtensionMessages.ts`

工作項目：
1. message handlers 依 domain 拆檔（agents/layout/chat/floor/settings）
2. 引入 reducer 或事件分派層，降低 setState 散落
3. 補關鍵 handler 測試（至少單元測試）

預估工時：2 ~ 3 天

驗收標準：
- `useExtensionMessages.ts` 主檔 < 300 行
- 主要 message 類型有對應測試

---

### PR-6：雙前端程式碼收斂策略（優先中低）
範圍：`web/client`, `webview-ui`

工作項目：
1. 決策：單一來源 or shared core package
2. **定義 `TransportLayer` 介面，抽象化 Socket.io 與 postMessage 的差異**
3. 若走 shared：抽 `office-engine`、`common-hooks` 到共用套件
4. 建立同步規範（避免再分叉）

預估工時：3 ~ 6 天（視抽取範圍）

驗收標準：
- 重疊檔案數下降
- 關鍵引擎邏輯僅保留一份

## 推薦執行順序
1. PR-1
2. PR-2
3. PR-3
4. PR-4
5. PR-5
6. PR-6

## 建議里程碑
- M1（本週）：PR-1 + PR-3
- M2（下週）：PR-2
- M3（後續）：PR-4 + PR-5
- M4（架構）：PR-6

## Definition of Done（整體）
- CI：`typecheck/lint/test/build` 全綠
- Security：無預設弱帳密，關鍵操作需認證授權
- Maintainability：核心超大檔拆分完成並有對應測試
- Docs：README 指令與程式現況一致
