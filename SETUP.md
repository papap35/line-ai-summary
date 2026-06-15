# LINE AI 群組摘要機器人 — 安裝設定指南

## 系統架構

```
LINE 群組 → Webhook → Express 伺服器 → SQLite 儲存訊息
                                          ↓ (每天定時)
                                    Claude Haiku 分析
                                          ↓
                              LINE Push 推送每日摘要
```

## 前置需求

- Node.js 20+（或 Docker）
- 一個公開可存取的 HTTPS 網址（LINE Webhook 必須是 HTTPS）
- LINE Developers 帳號
- Anthropic API 金鑰

---

## 步驟一：建立 LINE Messaging API 頻道

1. 前往 [LINE Developers Console](https://developers.line.biz/console/)
2. 建立新的 **Provider**（如果還沒有）
3. 建立新的 **Messaging API channel**
4. 在 **Basic settings** 頁面取得：
   - `Channel secret` → 填入 `LINE_CHANNEL_SECRET`
5. 在 **Messaging API** 頁面：
   - 發行 `Channel access token (long-lived)` → 填入 `LINE_CHANNEL_ACCESS_TOKEN`
   - 關閉 **Auto-reply messages**
   - 關閉 **Greeting messages**

## 步驟二：設定環境變數

```bash
cp .env.example .env
```

編輯 `.env`，填入你的金鑰：

```env
LINE_CHANNEL_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LINE_CHANNEL_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SUMMARY_HOUR=20       # 每晚幾點發送摘要（24小時制）
SUMMARY_MINUTE=0
TARGET_GROUP_ID=      # 留空 = 所有群組；填入特定 Group ID 則只摘要該群
MESSAGE_RETENTION_DAYS=7
TIMEZONE=Asia/Taipei
PORT=5000
```

## 步驟三：啟動服務

### 方法 A：Docker（推薦）

```bash
docker compose up -d
```

### 方法 B：直接用 Node.js

```bash
yarn install
yarn start
```

## 步驟四：設定 Webhook URL

你的伺服器必須有公開的 HTTPS 網址。推薦用 [ngrok](https://ngrok.com/) 做本地測試：

```bash
ngrok http 5000
```

ngrok 會給你一個類似 `https://xxxx.ngrok-free.app` 的網址。

1. 回到 LINE Developers Console → **Messaging API** 頁面
2. **Webhook URL** 填入：`https://你的網址/webhook`
3. 點選 **Verify** 確認連線正常（應回傳 200 OK）
4. 開啟 **Use webhook**

## 步驟五：將 Bot 加入群組並取得 Group ID

1. 在 LINE Developers Console → **Messaging API** → 掃描 QR code 加機器人為好友
2. 在 LINE 中將機器人邀請加入你的群組
3. 在群組中隨意傳一則訊息
4. 查看伺服器 log，會看到類似：

   ```
   Saved message from Uxxxxxxxx in group Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

   `C` 開頭那串就是 `GROUP_ID`
5. 將 `TARGET_GROUP_ID` 填入 `.env`，重啟服務

## 手動觸發摘要（測試用）

```bash
yarn summarize
```

---

## 常見問題

**Q: 為什麼機器人無法取得歷史訊息？**
A: LINE API 限制，Bot 只能接收加入群組「之後」的訊息，無法讀取歷史記錄。

**Q: 摘要發送時間可以改嗎？**
A: 修改 `.env` 中的 `SUMMARY_HOUR`、`SUMMARY_MINUTE` 和 `TIMEZONE`，重啟服務即可。

**Q: 訊息資料保存多久？**
A: 預設 7 天（`MESSAGE_RETENTION_DAYS`），每次發送摘要後自動清理舊資料。
