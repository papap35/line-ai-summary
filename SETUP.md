# LINE AI 群組摘要機器人 — Google Cloud 部署指南

## 系統架構

```
LINE 群組 → Webhook → Cloud Run (Express) → Firestore 儲存訊息/摘要
                                                    ↑
Cloud Scheduler ──(每天定時 POST /api/run-summary)──┘
                                                    ↓
                                          Claude Haiku 分析
                                                    ↓
                                      LINE Push 推送每日摘要
```

- **Cloud Run**：執行 Express 伺服器，接收 LINE webhook、處理每日摘要請求
- **Firestore**：取代 SQLite，儲存訊息與摘要（Native mode）
- **Cloud Scheduler**：取代 in-process cron，每天定時呼叫 `/api/run-summary`
- **Secret Manager**：存放 LINE / Anthropic 金鑰與 `CRON_SECRET`，Cloud Run 部署時以環境變數形式掛載，避免明文存在服務設定中
- **GitHub Actions**（可選）：PR/push 時跑測試；merge 到 `main` 後透過 Workload Identity Federation 自動部署到 Cloud Run，見步驟九

## 快速部署（適合已熟悉 gcloud 的人）

`scripts/` 內已將下方步驟整理成腳本，在本機（已執行 `gcloud auth login`）依序執行：

```bash
cp .env.example .env   # 填入 LINE / Anthropic 金鑰、GOOGLE_CLOUD_PROJECT、CRON_SECRET 等
./scripts/01-setup-gcp.sh        # 啟用 API、建立 Firestore + index、建立本機開發用 service account
./scripts/02-setup-secrets.sh    # 將金鑰寫入 Secret Manager，並授權 Cloud Run 讀取
./scripts/03-deploy.sh           # 部署到 Cloud Run，輸出服務網址
./scripts/04-setup-scheduler.sh  # 建立/更新 Cloud Scheduler 每日摘要 job
./scripts/05-setup-cicd.sh       # （可選）設定 GitHub Actions 自動部署，見步驟九
```

接著到 LINE Developers Console 設定 Webhook URL（見步驟五）。下面是完整的逐步說明，第一次操作或想了解每個指令的用途建議閱讀。

## 前置需求

- Node.js 20+（本機開發用）
- [gcloud CLI](https://cloud.google.com/sdk/docs/install)
- 一個 GCP 專案（已啟用帳單，免費額度足夠這個專案使用）
- LINE Developers 帳號
- Anthropic API 金鑰

---

## 步驟一：建立 LINE Messaging API 頻道

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 建立新的 **Provider**（如果還沒有）
3. 建立新的 **Messaging API channel**
4. 在 **Basic settings** 頁面取得：
   - `Channel secret` → 之後填入 `LINE_CHANNEL_SECRET`
5. 在 **Messaging API** 頁面：
   - 發行 `Channel access token (long-lived)` → 之後填入 `LINE_CHANNEL_ACCESS_TOKEN`
   - 關閉 **Auto-reply messages**
   - 關閉 **Greeting messages**

## 步驟二：設定 GCP 專案與 Firestore

```bash
# 設定當前專案
gcloud config set project YOUR_PROJECT_ID

# 啟用所需的 API
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

# 建立 Firestore 資料庫（Native mode）
gcloud firestore databases create --location=asia-east1
```

> Firestore 的免費額度（1GiB 儲存、每日 5萬讀/2萬寫）對個人或小型群組綽綽有餘。

### 建立 composite index

`getTodayMessages` 需要對 `messages` collection 做 `groupId` 等於 + `timestamp` 範圍查詢，需要一個 composite index：

```bash
gcloud firestore indexes composite create \
  --collection-group=messages \
  --field-config=field-path=groupId,order=ascending \
  --field-config=field-path=timestamp,order=ascending
```

（這個設定也記錄在 `firestore.indexes.json`，如果你改用 Firebase CLI 可直接 `firebase deploy --only firestore:indexes`）

## 步驟三：本機開發環境設定

```bash
cp .env.example .env
yarn install
```

編輯 `.env`：

```env
LINE_CHANNEL_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LINE_CHANNEL_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TARGET_GROUP_ID=      # 留空 = 所有群組；填入特定 Group ID 則只摘要該群
MESSAGE_RETENTION_DAYS=7
TIMEZONE=Asia/Taipei
PORT=8080
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
CRON_SECRET=用一個隨機字串
```

### 取得本機開發用的 service account 金鑰

```bash
gcloud iam service-accounts create line-ai-summary-dev \
  --display-name="line-ai-summary local dev"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:line-ai-summary-dev@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud iam service-accounts keys create service-account.json \
  --iam-account="line-ai-summary-dev@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

`service-account.json` 已加入 `.gitignore`，**切勿提交到版本控制**。

### 啟動本機伺服器

```bash
yarn start
```

## 步驟四：設定 Secret Manager

LINE / Anthropic 金鑰與 `CRON_SECRET` 不會以明文存在 Cloud Run 環境變數中，而是存放在 Secret Manager，部署時掛載為環境變數。

```bash
gcloud services enable secretmanager.googleapis.com

# 將 .env 中的敏感值寫入對應的 secret（以 LINE_CHANNEL_ACCESS_TOKEN 為例）
printf '%s' "你的LINE Channel Access Token" | \
  gcloud secrets create line-ai-summary-line-channel-access-token \
  --data-file=- --replication-policy=automatic

# 對 LINE_CHANNEL_SECRET、ANTHROPIC_API_KEY、CRON_SECRET 重複上述步驟，
# secret 名稱依序為：
#   line-ai-summary-line-channel-secret
#   line-ai-summary-anthropic-api-key
#   line-ai-summary-cron-secret

# 授權 Cloud Run 預設運算服務帳戶讀取每一個 secret
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding line-ai-summary-line-channel-access-token \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
# 其餘三個 secret 重複上述授權指令
```

> 想省事可直接執行 `./scripts/02-setup-secrets.sh`，它會讀取 `.env` 並自動完成上面所有步驟（建立/更新 4 個 secret + 授權）。

## 步驟五：部署到 Cloud Run

```bash
gcloud run deploy line-ai-summary \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,TIMEZONE=Asia/Taipei,MESSAGE_RETENTION_DAYS=7,TARGET_GROUP_ID=,ADMIN_USER_ID=,ADMIN_GROUP_ID=" \
  --set-secrets="LINE_CHANNEL_ACCESS_TOKEN=line-ai-summary-line-channel-access-token:latest,LINE_CHANNEL_SECRET=line-ai-summary-line-channel-secret:latest,ANTHROPIC_API_KEY=line-ai-summary-anthropic-api-key:latest,CRON_SECRET=line-ai-summary-cron-secret:latest"
```

> `--allow-unauthenticated` 是因為 LINE webhook 需要能匿名呼叫。`/api/run-summary` 路徑則靠 `CRON_SECRET` 做應用層驗證。
>
> 部署完成後，Cloud Run 會自動透過內建服務帳戶存取 Firestore，記得確認該服務帳戶有 `roles/datastore.user` 權限（新專案的預設運算服務帳戶通常已具備，若無則執行）：
>
> ```bash
> gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
>   --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
>   --role="roles/datastore.user"
> ```

部署成功後會得到一個網址，例如 `https://line-ai-summary-xxxxx.asia-east1.run.app`。

## 步驟六：設定 LINE Webhook URL

1. 回到 LINE Developers Console → **Messaging API** 頁面
2. **Webhook URL** 填入：`https://你的Cloud Run網址/webhook`
3. 點選 **Verify** 確認連線正常（應回傳 200 OK）
4. 開啟 **Use webhook**

## 步驟七：將 Bot 加入群組並取得 Group ID

1. 在 LINE Developers Console → **Messaging API** → 掃描 QR code 加機器人為好友
2. 在 LINE 中將機器人邀請加入你的群組
3. 在群組中隨意傳一則訊息
4. 查看 Cloud Run log：

   ```bash
   gcloud run services logs read line-ai-summary --region asia-east1 --limit 20
   ```

   會看到類似（結構化 JSON log）：

   ```json
   {"severity":"INFO","message":"Saved message","step":"save_message","groupId":"Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","userId":"Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
   ```

   `groupId` 中 `C` 開頭那串就是 `GROUP_ID`
5. （可選）將 `TARGET_GROUP_ID` 更新到 Cloud Run 環境變數，重新部署

## 步驟八：設定 Cloud Scheduler 每日摘要

```bash
gcloud scheduler jobs create http daily-summary \
  --location=asia-east1 \
  --schedule="0 20 * * *" \
  --time-zone="Asia/Taipei" \
  --uri="https://你的Cloud Run網址/api/run-summary" \
  --http-method=POST \
  --headers="X-Cron-Secret=用一個隨機字串"
```

上面的 `--schedule="0 20 * * *"` 是每天晚上 8 點（cron 語法：分 時 日 月 週）。

## 步驟九：設定 CI/CD（GitHub Actions 自動部署，可選）

`.github/workflows/ci-cd.yml` 定義了兩個 job：

- **test**：每次 push 或開 PR 都會執行 `yarn test`
- **deploy**：merge 到 `main` 後，自動執行 `./scripts/03-deploy.sh` 部署到 Cloud Run（需先通過 test job）

GCP 端的認證採用 [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)，GitHub Actions 不需要存放任何長期金鑰，而是用短期 OIDC token 換取一個專用 deploy service account 的權限。

1. 在 `.env` 設定 `GITHUB_REPO=papap35/line-ai-summary`，然後執行：

   ```bash
   ./scripts/05-setup-cicd.sh
   ```

   這會建立：
   - 一個限定此 repo 才能使用的 Workload Identity Pool/Provider
   - 一個 deploy service account（具備 `run.admin`/`cloudbuild.builds.editor`/`artifactregistry.writer`/`storage.admin`/`iam.serviceAccountUser`，足以執行 `gcloud run deploy --source`）

2. 腳本執行完會印出幾個值，到 GitHub repo **Settings → Secrets and variables → Actions → Variables** 分頁新增（注意是 **Variables**，不是 Secrets，因為這些值本身不是機密）：

   | Variable | 說明 |
   |---|---|
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | 腳本輸出的 Workload Identity Provider 完整路徑 |
   | `GCP_DEPLOY_SERVICE_ACCOUNT` | 腳本建立的 deploy service account email |
   | `GCP_PROJECT_ID` | GCP 專案 ID |
   | `GCP_REGION` | 部署區域（預設 `asia-east1`） |
   | `GCP_SERVICE_NAME` | Cloud Run 服務名稱（預設 `line-ai-summary`） |
   | `TARGET_GROUP_ID`、`MESSAGE_RETENTION_DAYS`、`TIMEZONE`、`ADMIN_USER_ID`、`ADMIN_GROUP_ID` | 對應 `.env` 中的同名非機密設定（可留空） |

3. 之後合併到 `main` 的 PR 會自動觸發部署；LINE / Anthropic 金鑰與 `CRON_SECRET` 仍只存在 Secret Manager（由 `./scripts/02-setup-secrets.sh` 管理），不會出現在 GitHub 任何設定中。

## 手動觸發摘要（測試用）

```bash
# 本機（直接連 Firestore）
yarn summarize

# 或對已部署的服務送請求
curl -X POST https://你的Cloud Run網址/api/run-summary \
  -H "X-Cron-Secret: 用一個隨機字串"
```

---

## 常見問題

**Q: 如何更新已部署服務的金鑰（LINE token、Anthropic key、CRON_SECRET）？**
A: 修改 `.env` 中對應的值，重新執行 `./scripts/02-setup-secrets.sh`（會新增一個 secret version 並設為 latest），Cloud Run 服務設定的是 `:latest`，但既有的 revision 不會自動套用新版本——需要重新部署（`./scripts/03-deploy.sh`）或手動 `gcloud run services update` 觸發新 revision。

**Q: 為什麼機器人無法取得歷史訊息？**
A: LINE API 限制，Bot 只能接收加入群組「之後」的訊息，無法讀取歷史記錄。

**Q: 摘要發送時間可以改嗎？**
A: 修改 Cloud Scheduler job 的 `--schedule` 與 `--time-zone`：

```bash
gcloud scheduler jobs update http daily-summary \
  --location=asia-east1 \
  --schedule="30 21 * * *"
```

**Q: 訊息資料保存多久？**
A: 預設 7 天（`MESSAGE_RETENTION_DAYS`），每次執行 `/api/run-summary` 後會自動清理舊資料。

**Q: Cloud Run 會不會冷啟動導致 webhook 逾時？**
A: 預設 `min-instances=0`，閒置一段時間後會 scale to 0，下次請求會有約 1~3 秒冷啟動，LINE 的 webhook timeout 通常足夠。如果在意可加 `--min-instances=1`，但會產生持續費用（超出免費額度）。

**Q: 如何在某個群組摘要失敗時收到通知？**
A: 設定 `.env` 中的 `ADMIN_USER_ID`（個人 LINE User ID）和/或 `ADMIN_GROUP_ID`（管理用群組的 Group ID），重新部署（`./scripts/03-deploy.sh`）。之後每次 `/api/run-summary` 執行時，若有任何群組處理失敗，會額外用 LINE Push 推送一則包含失敗群組 ID 與錯誤訊息的通知到這些對象。取得 User ID / Group ID 的方式與步驟六取得 `GROUP_ID` 相同——從 Cloud Run 結構化 log 的 `userId`/`groupId` 欄位讀取。

**Q: 程式的 log 是什麼格式？**
A: 所有 log 都是單行 JSON（含 `severity`、`message` 與其他情境欄位如 `groupId`、`dateStr`、`step`），方便在 Cloud Logging 中依欄位篩選，例如查詢 `jsonPayload.step="process_group" AND severity=ERROR` 找出失敗的群組。

**Q: 可以讓不同群組的摘要側重點不一樣嗎（例如工作群組重視待辦事項）？**
A: 可以。在群組內輸入 `/設定摘要 <說明文字>`（例如 `/設定摘要 請特別關注待辦事項與截止日期`），機器人會把這段文字附加到該群組的摘要 system prompt 後面，並回覆「已更新本群組的摘要自訂指示。」之後每日摘要都會套用，直到再次輸入指令覆蓋為止。這個指令訊息本身不會被存入當日對話記錄。

**Q: GitHub Actions 部署失敗，要怎麼排查？**
A: 先看 Actions 頁面的 log：`auth` 步驟失敗通常是 `GCP_WORKLOAD_IDENTITY_PROVIDER`/`GCP_DEPLOY_SERVICE_ACCOUNT` 兩個 Variables 設錯，或 `scripts/05-setup-cicd.sh` 還沒執行；`Deploy to Cloud Run` 步驟失敗常見原因是 deploy service account 缺少角色（重新執行一次 `05-setup-cicd.sh` 確認權限）或是 Secret Manager 裡的金鑰還沒建立（先跑過 `02-setup-secrets.sh`）。
