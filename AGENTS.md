# AGENTS.md — LINE AI 群組摘要機器人 開發規範手冊

本文件定義 AI agent（及人類開發者）在這個專案中「怎麼做」與「品質門檻」。
搭配 `SPEC.md`（決定做什麼、按什麼順序）與 `AI_PROJECT_SOP.md`（協作流程）一起使用。

---

## 1. 寫程式的原則

### 1.1 分層架構

依賴方向固定為：

```
src/app.js  ──┐
              ├──> src/summaryJob.js ──> src/database.js
src/run-summary.js ──┘                └─> src/summarizer.js
```

- **`src/app.js`**：Express 入口、路由、LINE webhook 事件處理（`handleEvent`）。只負責「收請求 → 呼叫下層 → 回應」，不寫業務邏輯。
- **`src/summaryJob.js`**：每日摘要的業務邏輯（`runDailySummary`）。被 `app.js`（HTTP 路由）與 `run-summary.js`（CLI）共用，因此**不可**依賴 Express 的 `req`/`res`。
- **`src/database.js`**：唯一允許直接呼叫 Firestore SDK 的模組。其他模組一律透過這裡 export 的函式存取資料，不直接 `new Firestore()`。
- **`src/summarizer.js`**：唯一允許直接呼叫 Anthropic SDK 的模組。

新增功能時，先判斷屬於哪一層；不要讓 `app.js` 直接讀寫 Firestore，也不要讓 `database.js` 知道 LINE/Claude 的存在。

### 1.2 純函式優先

像 `database.js` 的 `todayString()`、`dayRange()` 這類「給輸入就有固定輸出、不碰外部資源」的邏輯，盡量寫成獨立的純函式（可 export 出來），方便未來寫單元測試時不需要 mock Firestore。

### 1.3 防禦性資料處理

- LINE 訊息事件的欄位（`event.source.groupId`、`event.message.text` 等）來自外部輸入，使用前先確認 `event.type`/`event.source.type`/`event.message.type`（參考 `app.js` 現有的 `handleEvent` 寫法）。
- 從 Firestore 讀回的欄位若可能為 `null`（例如 `displayName`），在組裝給 Claude 的內容前要有 fallback（參考 `summarizer.js` 的 `formatMessages`：`m.display_name || m.user_id || '未知用戶'`）。
- 數值型環境變數（`MESSAGE_RETENTION_DAYS` 等）一律用 `parseInt(..., 10)` 並提供預設值，不要假設 `.env` 一定有設定。

### 1.4 錯誤處理慣例

- **單一群組的失敗不能影響其他群組**：`runDailySummary()` 對每個群組的處理包在 `try/catch` 內，失敗只 `console.error` 並 `continue`（見現有實作）。新增任何「逐群組」邏輯都要遵守這個模式。
- **HTTP 路由一律要回應**：任何 `app.js` 的路由 handler，所有 async 操作都要在 `try/catch` 內，確保不會有 unhandled rejection（會讓 Cloud Run 容器崩潰）。已知例外：Firestore client 初始化失敗（無有效認證）目前不會被路由的 try/catch 捕捉，這是已知限制，記錄於 `SPEC.md` 技術債章節，修正前不要假設它已被處理。
- **不要吞掉錯誤訊息**：`catch` 區塊至少要 `console.error('描述', err)`，方便在 Cloud Logging 追蹤。

### 1.5 環境變數與時區

- 所有「今天」「日期區間」的計算一律透過 `src/database.js` 的 `todayString()` / `dayRange()`，並以 `process.env.TIMEZONE`（預設 `Asia/Taipei`）為基準，禁止直接用 `new Date()` 做日期切分（會用到容器的 UTC 時間，導致跨日錯誤）。

---

## 2. 測試的原則

專案已導入 `vitest`（`SPEC.md` P0 #1）。規則如下：

- **必須有測試的程式碼**：`src/database.js` 中可獨立測試的純函式（`todayString`、`dayRange`，見 `src/database.test.js`）、`src/summaryJob.js` 的 `runDailySummary` 流程控制（mock `./database.js`、`./summarizer.js`、`@line/bot-sdk`，見 `src/summaryJob.test.js`）。新增同類型邏輯時要補對應測試。
- **Mock 慣例**：對 `@line/bot-sdk`、`./database.js`、`./summarizer.js` 等有外部依賴（Firestore/LINE/Claude API）的模組一律用 `vi.mock` 隔離，測試不應觸發真實網路呼叫。需要在 mock factory 內參照外部變數時，用 `vi.hoisted()` 避免 TDZ 錯誤；mock 建構子（如 `MessagingApiClient`）需用具名 `function` 而非箭頭函式，才能被 `new` 呼叫。
- **防迴歸測試規則**：修 bug 時，先寫一個會在修復前失敗、修復後通過的測試，再修正邏輯。
- **測試命名規範**：測試檔案放在被測檔案旁，命名為 `<name>.test.js`（例如 `src/database.test.js`）。測試描述使用「做什麼 + 預期結果」的句式，例如 `dayRange 在跨日邊界回傳正確的 UTC 範圍`。
- **執行指令**：`yarn test`（執行 `vitest run`，單次執行不進入 watch mode）。

---

## 3. 開發流程原則

### 3.1 Branch 命名規則

`<type>/<scope>-<簡述>`，例如：

- `feat/summary-custom-prompt`（新功能）
- `fix/purge-timezone-boundary`（bug fix）
- `docs/spec-update`（純文件）
- `test/database-daterange`（補測試）
- `chore/deps-bump`（依賴/工具調整）

### 3.2 PR 前自我 review checklist（硬性門檻）

- [ ] 程式碼是否符合第 1 章的分層原則（沒有跨層直接呼叫）？
- [ ] 新增的環境變數是否同步更新 `.env.example`，且不含真實密鑰？
- [ ] 是否誤動到 `.env`、`service-account.json`、`node_modules/`（應被 `.gitignore` 排除）？
- [ ] 若新增/修改使用者可見行為（指令、推播格式、API 回應），`SETUP.md` 或 `SPEC.md` 是否同步更新？
- [ ] **`SPEC.md` 對應項目的狀態標記是否更新**（`[ ]` → `[x]` 或 `[~]`，見第 5 章）？
- [ ] 是否在本機跑過基本驗證（`yarn start` 起得來、`/health` 回 200，或相關的 `yarn summarize`/curl 測試）？

---

## 4. Commit 原則

採用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <description>

[optional body]
```

常用 `type`：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`。
`scope` 建議用模組名，例如 `summarizer`、`database`、`scheduler`、`webhook`、`deploy`。

範例：
- `feat(webhook): 支援 /摘要 關鍵字指令補發當日摘要`
- `fix(database): 修正 purgeOldMessages 跨時區邊界計算`
- `docs(spec): 標記功能4為完成並新增功能9`

### Commit 前檢查清單

- [ ] `git status` 確認沒有 `.env`、`service-account.json`、`*.key` 等敏感檔案被加入
- [ ] commit message 描述「為什麼」而不只是「改了什麼」
- [ ] 一個 commit 對應一個邏輯變更（文件同步可與對應功能放同一個 commit）

---

## 5. SPEC.md 判讀與更新原則

### 5.1 優先級判讀規則

`SPEC.md` 的 P0 → P1 → P2 → P3 → ... 代表建議的開發順序，但**「優先開發路徑建議」一節的箭頭順序才是最終依據**——若兩者衝突（例如新增功能未按編號排序），以路徑建議為準。

### 5.2 狀態標記

- `[ ]`：尚未開始
- `[~]`：進行中 / 部分完成（例如「最小可用版本完成，剩餘部分拆成新項目」）
- `[x]`：完成（程式碼 + 測試 + 文件同步皆完成）
- `[-]`：已取消或不再需要（保留紀錄但不執行）

### 5.3 新增功能時的格式範本

新增項目時複製以下範本，編號接續現有最大編號：

```markdown
#### N. 功能名稱 `[ ]`

**背景**：一句話說明痛點或動機

**功能規格**：
- 具體、可驗收的行為描述
- 涉及的檔案/模組

---
```

若新功能與現有優先級分類（P0-P3）邏輯不符，新增一個分類（例如 P4），不要硬塞。

---

## 附錄：技術棧速查表

| 項目 | 內容 |
|---|---|
| 執行環境 | Node.js 20+, ES Modules (`"type": "module"`) |
| 套件管理 | yarn (`yarn install`) |
| Web 框架 | Express 4 |
| LINE SDK | `@line/bot-sdk` v9（`messagingApi.MessagingApiClient`, `middleware`） |
| AI SDK | `@anthropic-ai/sdk`，模型 `claude-haiku-4-5` |
| 資料庫 | Google Cloud Firestore (Native mode)，`@google-cloud/firestore` v8 |
| 時間處理 | `luxon`，時區由 `TIMEZONE` 環境變數控制（預設 `Asia/Taipei`） |
| 本機啟動 | `yarn start`（伺服器）／`yarn summarize`（手動跑一次每日摘要） |
| 部署 | Docker → Cloud Run（`scripts/03-deploy.sh`） |
| 密鑰管理 | Secret Manager（`scripts/02-setup-secrets.sh`），LINE/Anthropic 金鑰與 `CRON_SECRET` 以 `--set-secrets` 掛載 |
| 排程 | Cloud Scheduler → `POST /api/run-summary`（`scripts/04-setup-scheduler.sh`，需 `X-Cron-Secret` header） |
| 初始化腳本 | `scripts/01-setup-gcp.sh`（啟用 API、建立 Firestore + index + dev service account） |
| 設定文件 | `SETUP.md`（完整部署步驟）、`.env.example`（環境變數範本） |
