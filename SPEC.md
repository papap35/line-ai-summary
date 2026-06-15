# SPEC.md — LINE AI 群組摘要機器人 功能規格與路線圖

## 現有功能盤點

| 模組 | 已完成 |
|---|---|
| LINE Webhook 收訊（群組文字訊息） | ✅ |
| Firestore 訊息儲存（`messages` / `groupActivity`） | ✅ |
| 每日摘要生成（Claude Haiku，`src/summarizer.js`） | ✅ |
| 摘要結果儲存（`summaries` collection） | ✅ |
| LINE Push 推送每日摘要 | ✅ |
| 舊訊息自動清理（`purgeOldMessages`） | ✅ |
| Cloud Run 部署（Dockerfile + `scripts/02-deploy.sh`） | ✅ |
| Cloud Scheduler 每日排程（`scripts/03-setup-scheduler.sh`） | ✅ |
| `CRON_SECRET` 保護 `/api/run-summary` | ✅ |

## 待開發功能規格

### P0 — 穩定性與安全（必做，理由：目前無自動化測試與監控，回歸風險與故障難察覺）

#### 1. 加入自動化測試框架與核心單元測試 `[x]`

**背景**：目前專案完全沒有測試，`database.js`、`summaryJob.js`、`summarizer.js` 的邏輯（例如 `dayRange`、`purgeOldMessages`、`runDailySummary` 的跳過/錯誤隔離邏輯）只能靠手動測試，改動時容易產生回歸。

**功能規格**：
- 導入 `vitest` 作為測試框架（`package.json` 新增 `devDependencies` 與 `test` script）
- 針對 `src/database.js` 的 `dayRange()`、`todayString()` 寫純函式單元測試（不需連接真實 Firestore，可用 `@firebase/rules-unit-testing` 或 Firestore emulator，或將純計算邏輯抽出）
- 針對 `src/summaryJob.js` 的 `runDailySummary()` 寫測試：mock `db` 與 `summarize`/`sendLineMessage`，驗證「已有摘要則跳過」「單一群組失敗不影響其他群組」「`TARGET_GROUP_ID` 設定時只處理該群組」
- 涉及檔案：`package.json`、`src/database.js`（可能需重構以分離純邏輯）、`src/summaryJob.js`、新增 `src/*.test.js` 或 `test/` 目錄

> 實作備註：`dayRange()` 改為 `export`；`src/database.test.js` 涵蓋 `todayString`/`dayRange` 的時區邊界；`src/summaryJob.test.js` 透過 `vi.mock` 模擬 `@line/bot-sdk`、`./database.js`、`./summarizer.js`，涵蓋上述四種情境。執行 `yarn test`。

---

#### 2. 結構化 log 與錯誤通知 `[ ]`

**背景**：目前 `console.log`/`console.error` 是唯一的可觀測性手段。`/api/run-summary` 若整體失敗（如步驟 3 提到的 Firestore 認證問題）只會回 500，使用者要等到沒收到摘要才會發現，且要去翻 Cloud Run log 才能定位問題。

**功能規格**：
- `src/app.js`、`src/summaryJob.js` 的 log 改為結構化 JSON（含 `groupId`、`dateStr`、`step` 欄位），方便在 Cloud Logging 中過濾
- `runDailySummary()` 執行完成後（無論成功或部分失敗），若有任一群組處理失敗，透過 LINE Push 通知一個「管理者」群組/個人（可用新增環境變數 `ADMIN_USER_ID` 或 `ADMIN_GROUP_ID`）
- 涉及檔案：`src/app.js`、`src/summaryJob.js`、`.env.example`、`SETUP.md`

---

#### 3. Secret Manager 整合 `[ ]`

**背景**：目前 `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`ANTHROPIC_API_KEY`、`CRON_SECRET` 都以明文環境變數的形式存在 `scripts/02-deploy.sh` 產生的設定與 Cloud Run 服務設定中，且本機 `.env` 內也是明文。

**功能規格**：
- `scripts/02-deploy.sh` 改用 `gcloud secrets create` 建立 Secret Manager 密鑰，部署時用 `--set-secrets` 掛載而非 `--set-env-vars`
- 新增 `scripts/00-setup-secrets.sh`（或併入 `01-setup-gcp.sh`）：讀取 `.env` 中的敏感值，建立/更新對應的 Secret Manager 密鑰
- `SETUP.md` 補充說明 Secret Manager 設定步驟與所需 IAM 權限（`roles/secretmanager.secretAccessor`）
- 涉及檔案：`scripts/01-setup-gcp.sh`、`scripts/02-deploy.sh`、`SETUP.md`

---

### P1 — 核心摘要品質（核心價值主張的必要功能）

#### 4. 非文字訊息處理 `[ ]`

**背景**：`src/app.js` 的 `handleEvent()` 目前只處理 `event.message.type === 'text'`，圖片、貼圖、檔案、位置等訊息完全被忽略。如果群組討論搭配了圖片（例如會議照片、文件截圖），摘要會漏掉上下文，使用者讀摘要時可能會看到「[有人傳了訊息但沒寫什麼]」這種斷裂感。

**功能規格**：
- 將貼圖（sticker）、圖片、檔案、位置等事件也存入 `messages`，以一個 placeholder 文字描述（例如 `[貼圖]`、`[圖片]`、`[檔案: ${fileName}]`、`[位置: ${title}]`）讓 `summarizer.js` 至少知道「這裡有非文字內容」，不需真的做圖片辨識
- `src/database.js` 的 `saveMessage` 新增可選欄位 `messageType`
- 涉及檔案：`src/app.js`（`handleEvent`）、`src/database.js`

---

#### 5. 摘要 Prompt 可依群組自訂 `[ ]`

**背景**：目前所有群組都共用 `src/summarizer.js` 的同一份 `SYSTEM_PROMPT`。但不同群組性質差異很大（例如工作群組重視待辦事項，朋友群組重視活動資訊），固定 prompt 對某些群組可能抓不到重點。

**功能規格**：
- 新增 Firestore collection `groupSettings`（doc ID = `groupId`），可儲存 `customPromptSuffix`（附加在預設 system prompt 之後的客製化指示）
- `src/summarizer.js` 的 `summarize()` 讀取 `groupSettings` 並合併進 system prompt；若無設定則沿用預設行為
- 提供一個簡單的設定方式（例如 LINE 訊息指令 `/設定摘要 <說明文字>`，由管理員在群組內輸入，`handleEvent` 偵測並寫入 `groupSettings`）
- 涉及檔案：`src/database.js`（新增 `getGroupSettings`/`saveGroupSettings`）、`src/summarizer.js`、`src/app.js`

---

### P2 — 使用體驗（提升效率的進階功能）

#### 6. 補發摘要指令（關鍵字觸發） `[ ]`

**背景**：目前摘要只能透過 Cloud Scheduler 在固定時間自動觸發，或本機手動跑 `yarn summarize`（對所有/`TARGET_GROUP_ID` 群組）。如果群組成員當天錯過摘要、或想立刻看「目前為止」的重點，沒有辦法主動觸發。

**功能規格**：
- `src/app.js` 的 `handleEvent()` 偵測訊息內容是否為特定關鍵字（例如 `/摘要` 或 `@小助手 摘要`）
- 偵測到後，呼叫 `summarize()` 處理「該群組從今天 00:00 到現在」的訊息（重用 `db.getTodayMessages`），直接以該則訊息的 reply token 回覆，而不更新 `summaries` collection（避免影響每日正式摘要的「已產生則跳過」邏輯）
- 涉及檔案：`src/app.js`、`src/summarizer.js`（可能需要讓 `summarize` 不強制要求完整一天的資料）

---

#### 7. 查詢歷史摘要 `[ ]`

**背景**：`summaries` collection 已經儲存了每天的摘要，但目前沒有任何方式讀取「昨天」或「上週某天」的摘要——使用者只能在當天收到推播時看到。

**功能規格**：
- `src/app.js` 的 `handleEvent()` 新增指令解析，例如 `/摘要 2026-06-10` 或 `/昨天摘要`
- 解析出目標日期後呼叫 `db.getSummary(groupId, dateStr)`，若存在則回覆內容，不存在則回覆「該日無摘要記錄」
- 注意與 `MESSAGE_RETENTION_DAYS` 的關係：`purgeOldMessages` 目前只刪 `messages`/`groupActivity`，不會刪 `summaries`，因此歷史摘要可保留更久——但仍建議在規格中明確說明 `summaries` 的保留策略（目前是永久保留）
- 涉及檔案：`src/app.js`、`src/database.js`

---

### P3 — 長期維運（長期使用必備但非急迫）

#### 8. 摘要存檔網頁 `[ ]`

**背景**：隨著 `summaries` collection 累積，純靠 LINE 訊息回覆查詢歷史摘要（功能 7）體驗有限——無法瀏覽列表、無法搜尋關鍵字。

**功能規格**：
- 新增一個簡單的唯讀網頁（`/archive` 路由 + 靜態頁面或最小前端），依 `groupId` + 日期範圍列出歷史摘要
- 需考慮存取控制（例如以 `groupId` 對應一個不易猜測的 token 作為網址路徑的一部分，避免任意第三方查看其他群組的摘要）
- 涉及檔案：新增 `src/app.js` 路由、可能新增 `views/` 或 `public/` 目錄

---

## 技術債與基礎強化

- **`runDailySummary()` 同步處理多群組可能逾時**：`/api/run-summary` 目前以 `for...of` 依序處理每個群組（每個群組都呼叫一次 Claude API），若群組數量多，總執行時間可能超過 Cloud Run 預設的 request timeout（300 秒）。短期可在 `scripts/02-deploy.sh` 的 `gcloud run deploy` 加上 `--timeout`，長期應評估改為非同步任務佇列（例如 Cloud Tasks）。
- **`purgeOldMessages` 缺乏測試**：刪除邏輯（`deleteInBatches` + 日期邊界計算）目前無測試覆蓋，若邊界計算錯誤可能誤刪當日資料。應隨功能 1（自動化測試）一併補上。
- **Firestore 認證在本機沙箱環境的限制**：本機/CI 若無有效的 `GOOGLE_APPLICATION_CREDENTIALS` 或 ADC，`@google-cloud/firestore` 會在初始化時拋出未被路由 try/catch 捕捉的 unhandled rejection，導致整個程序崩潰而非回應錯誤。長期可考慮將 Firestore client 初始化改為 lazy/可注入，方便測試時 mock（與功能 1 相關）。

## 優先開發路徑建議

建議開發順序：`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8`

理由：先補上測試與可觀測性／安全基礎（P0），讓後續每個功能都能在有測試保護的狀態下開發；再強化核心摘要品質（P1：非文字訊息、自訂 prompt）；接著是互動體驗（P2：手動觸發、查詢歷史）；最後是長期維運型功能（P3：網頁存檔）。
